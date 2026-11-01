#!/usr/bin/env node
// Static inventory only. Missing dynamic references are review candidates, not
// authorization to delete a source module or media asset.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const root=process.cwd();
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const sources=files.filter(f=>/\.(?:[cm]?js|tsx?)$/.test(f)&&/^(src|scripts|test)\//.test(f));
const text=new Map(sources.map(f=>[f,fs.readFileSync(f,'utf8')]));
const edges=new Map(sources.map(f=>[f,new Set()])),missing=[];
function local(from,specifier){
  let base=path.resolve(root,path.dirname(from),specifier);
  if(base.startsWith(path.join(root,'dist/src')+path.sep))base=base.replace(path.join(root,'dist/src'),path.join(root,'src'));
  const possibilities=[base,base.replace(/\.js$/,'.ts'),base.replace(/\.js$/,'.tsx'),`${base}.ts`,`${base}.tsx`,`${base}.js`,path.join(base,'index.ts')];
  return possibilities.find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
}
for(const [file,contents] of text){
  const ast=ts.createSourceFile(file,contents,ts.ScriptTarget.Latest,true);
  const visit=node=>{
    const literal=(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))?node.moduleSpecifier:
      ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword?node.arguments[0]:
      ts.isNewExpression(node)&&node.expression.getText(ast)==='URL'?node.arguments?.[0]:undefined;
    if(literal&&ts.isStringLiteral(literal)&&literal.text.startsWith('.')){
      const target=local(file,literal.text);
      if(target)edges.get(file).add(path.relative(root,target));
      else missing.push({file,specifier:literal.text});
    }
    ts.forEachChild(node,visit);
  };visit(ast);
  // Renderers name their entrypoints as strings rather than importing them.
  for(const match of contents.matchAll(/['"](?:dist\/)?((?:src|scripts)\/[^'"\s]+\.(?:tsx?|[cm]?js))['"]/g)){
    const target=local('package.json','./'+match[1]);if(target)edges.get(file).add(path.relative(root,target));
  }
  for(const match of contents.matchAll(/moduleAt\(['"]([^'"]+)['"]\)/g)){
    const target=local('package.json','./src/'+match[1]);if(target)edges.get(file).add(path.relative(root,target));
  }
}
const manifest=JSON.parse(fs.readFileSync('package.json','utf8'));
const roots=new Set(sources.filter(f=>f.startsWith('scripts/')));
for(const command of Object.values(manifest.scripts))for(const match of command.matchAll(/(?:src|scripts)\/[\w./-]+\.(?:tsx?|[cm]?js)/g))if(text.has(match[0]))roots.add(match[0]);
for(const file of files.filter(f=>f.startsWith('deploy/systemd/')))for(const match of fs.readFileSync(file,'utf8').matchAll(/(?:dist\/)?(src\/[\w./-]+\.js)/g)){
  const target=local('package.json','./'+match[1]);if(target)roots.add(path.relative(root,target));
}
const reachable=new Set(),queue=[...roots];
while(queue.length){const file=queue.pop();if(reachable.has(file))continue;reachable.add(file);for(const target of edges.get(file)??[])queue.push(target);}
const assetFiles=files.filter(f=>f.startsWith('assets/')&&!/\.(?:md|txt)$/i.test(f));
const referenceText=[...text.values(),...files.filter(f=>/^config\//.test(f)).map(f=>fs.readFileSync(f,'utf8'))].join('\n');
const report={generatedAt:new Date().toISOString(),trackedFiles:files.length,sourceFiles:sources.length,
  missingRelativeImports:missing,
  sourceModulesWithoutKnownEntrypoint:sources.filter(f=>f.startsWith('src/')&&!reachable.has(f)),
  trackedMediaAssets:assetFiles.length,
  assetReviewCandidates:assetFiles.filter(f=>!referenceText.includes(path.basename(f))),
  limitations:['Manual invocations, external consumers and computed asset names need human review.','No media or source files are deleted.','This inventory does not replace tests or runtime verification.']};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
