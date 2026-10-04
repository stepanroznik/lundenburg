/* Text -> libass bitmaps -> FFmpeg DVB display sets. No programme video decoded.
 * Uses the public libass API and avcodec_encode_subtitle/avformat APIs.
 */
#include <ass/ass.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/mem.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void check(int rc, const char *operation) {
    if (rc < 0) { char msg[AV_ERROR_MAX_STRING_SIZE]; av_strerror(rc, msg, sizeof msg); fprintf(stderr, "%s: %s\n", operation, msg); exit(1); }
}
static int compare_time(const void *a, const void *b) {
    int64_t x = *(const int64_t *)a, y = *(const int64_t *)b;
    return (x > y) - (x < y);
}
static AVSubtitle bitmap(ASS_Image *images, int width, int height) {
    AVSubtitle sub = {0};
    int left = width, top = height, right = 0, bottom = 0;
    for (ASS_Image *im = images; im; im = im->next) {
        if (!im->w || !im->h || (im->color & 255) == 255) continue;
        if (im->dst_x < left) left = im->dst_x;
        if (im->dst_y < top) top = im->dst_y;
        if (im->dst_x + im->w > right) right = im->dst_x + im->w;
        if (im->dst_y + im->h > bottom) bottom = im->dst_y + im->h;
    }
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (right > width) right = width;
    if (bottom > height) bottom = height;
    if (right <= left || bottom <= top) return sub;
    int w = right - left, h = bottom - top;
    uint8_t *grey = av_mallocz((size_t)w * h), *alpha = av_mallocz((size_t)w * h);
    if (!grey || !alpha) exit(1);
    for (ASS_Image *im = images; im; im = im->next) {
        int opacity = 255 - (im->color & 255);
        int luminance = (77 * ((im->color >> 24) & 255) + 150 * ((im->color >> 16) & 255) + 29 * ((im->color >> 8) & 255)) / 256;
        for (int y = 0; y < im->h; y++) for (int x = 0; x < im->w; x++) {
            int dx = im->dst_x + x - left, dy = im->dst_y + y - top;
            if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
            size_t p = (size_t)dy * w + dx;
            int a = im->bitmap[(size_t)y * im->stride + x] * opacity / 255;
            grey[p] = (luminance * a + grey[p] * (255 - a)) / 255;
            alpha[p] = a + alpha[p] * (255 - a) / 255;
        }
    }
    sub.num_rects = 1;
    sub.rects = av_mallocz(sizeof(*sub.rects));
    sub.rects[0] = av_mallocz(sizeof(AVSubtitleRect));
    AVSubtitleRect *rect = sub.rects[0];
    rect->type = SUBTITLE_BITMAP;
    rect->x = left; rect->y = top; rect->w = w; rect->h = h;
    rect->nb_colors = 16; rect->linesize[0] = w;
    rect->data[0] = av_malloc((size_t)w * h);
    rect->data[1] = av_malloc(16 * sizeof(uint32_t));
    if (!rect->data[0] || !rect->data[1]) exit(1);
    uint32_t *palette = (uint32_t *)rect->data[1];
    // Four alpha levels and four greys retain white glyphs, black outlines and
    // transparency while selecting DVB 4-bit RLE supported by older TVs.
    for (int a = 0; a < 4; a++) for (int g = 0; g < 4; g++) {
        unsigned v = g * 85;
        palette[a * 4 + g] = ((unsigned)(a * 85) << 24) | (v << 16) | (v << 8) | v;
    }
    for (size_t p = 0; p < (size_t)w * h; p++) {
        int g = alpha[p] ? grey[p] * 255 / alpha[p] : 0;
        if (g > 255) g = 255;
        rect->data[0][p] = (uint8_t)(((alpha[p] * 3 + 127) / 255) * 4 + (g * 3 + 127) / 255);
    }
    av_free(grey); av_free(alpha);
    // Styled ASS may position text at opposite corners. One bounding rectangle
    // then includes most of the (transparent) screen, exceeding DVB object and
    // decoder pixel-buffer limits. Tile and crop only occupied areas; preserve
    // exact screen coordinates and keep each encoded object well below 64 KiB.
    AVSubtitle tiled = {0};
    tiled.rects = av_mallocz((size_t)((w + 255) / 256) * ((h + 63) / 64) * sizeof(*tiled.rects));
    if (!tiled.rects) exit(1);
    for (int ty = 0; ty < h; ty += 64) for (int tx = 0; tx < w; tx += 256) {
        int tw = w - tx < 256 ? w - tx : 256, th = h - ty < 64 ? h - ty : 64;
        int xmin = tw, ymin = th, xmax = -1, ymax = -1;
        for (int y = 0; y < th; y++) for (int x = 0; x < tw; x++) {
            if (!(palette[rect->data[0][(ty + y) * w + tx + x]] >> 24)) continue;
            if (x < xmin) xmin = x;
            if (y < ymin) ymin = y;
            if (x > xmax) xmax = x;
            if (y > ymax) ymax = y;
        }
        if (xmax < xmin) continue;
        AVSubtitleRect *part = av_mallocz(sizeof(*part));
        if (!part) exit(1);
        part->type = SUBTITLE_BITMAP;
        part->x = left + tx + xmin; part->y = top + ty + ymin;
        part->w = xmax - xmin + 1; part->h = ymax - ymin + 1;
        part->nb_colors = 16; part->linesize[0] = part->w;
        part->data[0] = av_malloc((size_t)part->w * part->h);
        part->data[1] = av_memdup(rect->data[1], 16 * sizeof(uint32_t));
        if (!part->data[0] || !part->data[1]) exit(1);
        for (int y = 0; y < part->h; y++) memcpy(part->data[0] + y * part->w,
            rect->data[0] + (ty + ymin + y) * w + tx + xmin, part->w);
        tiled.rects[tiled.num_rects++] = part;
    }
    if (tiled.num_rects > 255) { fprintf(stderr, "Too many DVB regions\n"); exit(1); }
    avsubtitle_free(&sub);
    sub = tiled;
    return sub;
}
static void emit(AVFormatContext *mux, AVStream *stream, AVCodecContext *encoder, AVSubtitle *sub, int64_t from, int64_t until) {
    sub->pts = from * 1000;
    sub->start_display_time = 0;
    sub->end_display_time = (uint32_t)(until - from);
    int capacity = 4 * 1024 * 1024;
    uint8_t *data = av_malloc(capacity);
    int size = avcodec_encode_subtitle(encoder, data, capacity, sub);
    check(size, "encode DVB display set");
    if (size) {
        AVPacket *packet = av_packet_alloc();
        check(av_new_packet(packet, size), "allocate packet");
        memcpy(packet->data, data, size);
        packet->stream_index = stream->index;
        packet->pts = packet->dts = av_rescale_q(from, (AVRational){1,1000}, stream->time_base);
        packet->duration = av_rescale_q(until - from, (AVRational){1,1000}, stream->time_base);
        packet->flags |= AV_PKT_FLAG_KEY;
        check(av_interleaved_write_frame(mux, packet), "mux DVB packet");
        av_packet_free(&packet);
    }
    av_free(data);
}
static int verify(const char *file) {
    AVFormatContext *input = NULL;
    check(avformat_open_input(&input, file, NULL, NULL), "open DVB verification input");
    check(avformat_find_stream_info(input, NULL), "probe DVB verification input");
    int index = av_find_best_stream(input, AVMEDIA_TYPE_SUBTITLE, -1, -1, NULL, 0);
    check(index, "find DVB stream");
    AVStream *stream = input->streams[index];
    if (stream->codecpar->codec_id != AV_CODEC_ID_DVB_SUBTITLE) return 1;
    AVCodecContext *decoder = avcodec_alloc_context3(avcodec_find_decoder(AV_CODEC_ID_DVB_SUBTITLE));
    check(avcodec_parameters_to_context(decoder, stream->codecpar), "DVB decoder parameters");
    check(avcodec_open2(decoder, decoder->codec, NULL), "open DVB decoder");
    AVPacket *packet = av_packet_alloc();
    int nonempty = 0, clear = 0, max_depth = 0;
    int64_t white_pixels = 0, black_pixels = 0;
    int64_t previous = INT64_MIN;
    while (av_read_frame(input, packet) >= 0) {
        if (packet->stream_index == index) {
            // Check the actual region depth, not the decoder's palette size
            // (FFmpeg expands every decoded CLUT to 256 entries).
            for (int at = 0; at + 6 <= packet->size && packet->data[at] == 0x0f;) {
                int length = (packet->data[at + 4] << 8) | packet->data[at + 5];
                if (at + 6 + length > packet->size) return 1;
                if (packet->data[at + 1] == 0x11 && length >= 7) {
                    int depth = (packet->data[at + 12] >> 2) & 7;
                    if (depth >= 1 && depth <= 3 && (1 << depth) > max_depth) max_depth = 1 << depth;
                }
                at += 6 + length;
            }
            if (packet->pts != AV_NOPTS_VALUE && packet->pts < previous) return 1;
            if (packet->pts != AV_NOPTS_VALUE) previous = packet->pts;
            AVSubtitle subtitle = {0};
            int got = 0;
            check(avcodec_decode_subtitle2(decoder, &subtitle, &got, packet), "decode actual DVB bitmap");
            if (got) {
                if (!subtitle.num_rects) clear++;
                else {
                    int visible = 0;
                    for (unsigned r = 0; r < subtitle.num_rects; r++) {
                        AVSubtitleRect *rect = subtitle.rects[r];
                        if (rect->type != SUBTITLE_BITMAP || !rect->data[0] || !rect->data[1]) return 1;
                        uint32_t *palette = (uint32_t *)rect->data[1];
                        for (int y = 0; y < rect->h; y++) for (int x = 0; x < rect->w; x++) {
                            uint32_t color = palette[rect->data[0][y * rect->linesize[0] + x]];
                            if (color >> 24) visible = 1;
                            if ((color >> 24) >= 170) {
                                if (((color >> 16) & 255) >= 180 && ((color >> 8) & 255) >= 180 && (color & 255) >= 180) white_pixels++;
                                if (((color >> 16) & 255) < 64 && ((color >> 8) & 255) < 64 && (color & 255) < 64) black_pixels++;
                            }
                        }
                    }
                    nonempty += visible;
                }
            }
            avsubtitle_free(&subtitle);
        }
        av_packet_unref(packet);
    }
    av_packet_free(&packet); avcodec_free_context(&decoder); avformat_close_input(&input);
    printf("{\"nonempty\":%d,\"clear\":%d,\"maxDepth\":%d,\"whitePixels\":%lld,\"blackPixels\":%lld}\n",
        nonempty, clear, max_depth, (long long)white_pixels, (long long)black_pixels);
    return nonempty ? 0 : 1;
}
int main(int argc, char **argv) {
    if (argc == 3 && !strcmp(argv[1], "--verify")) return verify(argv[2]);
    if (argc != 7) { fprintf(stderr, "usage: render input.ass output.mkv width height duration-ms iso639-language\n"); return 2; }
    int width = atoi(argv[3]), height = atoi(argv[4]);
    int64_t duration = strtoll(argv[5], NULL, 10);
    if (width < 1 || width > 4096 || height < 1 || height > 2160 || duration < 1 || duration > 24 * 3600000LL) return 2;
    ASS_Library *library = ass_library_init();
    ASS_Renderer *renderer = ass_renderer_init(library);
    ass_set_frame_size(renderer, width, height);
    ass_set_storage_size(renderer, width, height);
    // Scale inline \fs overrides as well as default styles; changing only the
    // style FontSize leaves many imported SRT/ASS dialogue cues oversized.
    ass_set_font_scale(renderer, 0.65);
    ass_set_fonts(renderer, NULL, "DejaVu Sans", ASS_FONTPROVIDER_AUTODETECT, NULL, 1);
    ASS_Track *track = ass_read_file(library, argv[1], "UTF-8");
    if (!track || !track->n_events) { fprintf(stderr, "No subtitle cues\n"); return 1; }
    size_t capacity = (size_t)(duration / 100 + 4) + (size_t)track->n_events * 2;
    int64_t *times = malloc(capacity * sizeof(*times));
    size_t count = 0;
    for (int64_t t = 0; t < duration; t += 100) times[count++] = t;
    for (int i = 0; i < track->n_events; i++) {
        int64_t a = track->events[i].Start, b = a + track->events[i].Duration;
        if (a >= 0 && a < duration) times[count++] = a;
        if (b >= 0 && b < duration) times[count++] = b;
    }
    times[count++] = duration;
    qsort(times, count, sizeof(*times), compare_time);
    AVCodecContext *encoder = avcodec_alloc_context3(avcodec_find_encoder(AV_CODEC_ID_DVB_SUBTITLE));
    encoder->width = width; encoder->height = height; encoder->time_base = (AVRational){1,1000};
    // MPEG-TS needs the fifth byte to signal HD subtitle decoding. Without it
    // FFmpeg defaults to legacy type 0x10, even with an HD display definition.
    encoder->extradata = av_mallocz(5 + AV_INPUT_BUFFER_PADDING_SIZE); encoder->extradata_size = 5;
    encoder->extradata[1] = 1; encoder->extradata[3] = 1;
    encoder->extradata[4] = width > 720 || height > 576 ? 0x14 : 0x10;
    check(avcodec_open2(encoder, encoder->codec, NULL), "open DVB encoder");
    AVFormatContext *mux = NULL;
    check(avformat_alloc_output_context2(&mux, NULL, "matroska", argv[2]), "create cache muxer");
    AVStream *stream = avformat_new_stream(mux, NULL);
    check(avcodec_parameters_from_context(stream->codecpar, encoder), "subtitle parameters");
    stream->time_base = (AVRational){1,1000};
    av_dict_set(&stream->metadata, "language", argv[6], 0);
    av_dict_set(&stream->metadata, "title", "Selectable LKP subtitles", 0);
    check(avio_open(&mux->pb, argv[2], AVIO_FLAG_WRITE), "open cache");
    check(avformat_write_header(mux, NULL), "write subtitle header");
    AVSubtitle pending = {0};
    int64_t pending_at = 0;
    int emitted = 0;
    for (size_t i = 0; i < count; i++) {
        int64_t t = times[i];
        if (i && t == times[i - 1]) continue;
        int changed = 0;
        ASS_Image *images = ass_render_frame(renderer, track, t, &changed);
        // Repeat a visible display set once per second for channel tuning and
        // seeks into an active cue. Empty-state heartbeat is much less frequent.
        if (i && !changed && t != duration && t - pending_at < (pending.num_rects ? 1000 : 20000)) continue;
        if (t > pending_at) { emit(mux, stream, encoder, &pending, pending_at, t); emitted++; }
        avsubtitle_free(&pending);
        pending = bitmap(images, width, height);
        pending_at = t;
    }
    avsubtitle_free(&pending);
    AVSubtitle clear = {0};
    emit(mux, stream, encoder, &clear, duration, duration + 1);
    check(av_write_trailer(mux), "finish subtitle cache");
    avio_closep(&mux->pb); avformat_free_context(mux); avcodec_free_context(&encoder);
    ass_free_track(track); ass_renderer_done(renderer); ass_library_done(library); free(times);
    fprintf(stderr, "Prepared %d DVB display sets\n", emitted + 1);
    return 0;
}
