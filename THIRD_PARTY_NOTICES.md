# Android media engine notices

The Android application includes the following components. These notices identify the upstream licenses; they do not claim ownership of third-party code or change those licenses.

| Component | Included version | Upstream license and source |
| --- | --- | --- |
| youtubedl-android `library`, `ffmpeg`, `common` | 0.18.1 | [GPL-3.0](https://github.com/yausername/youtubedl-android/blob/0.18.1/LICENSE); [source tag](https://github.com/yausername/youtubedl-android/tree/0.18.1) |
| yt-dlp Unix zipimport executable | Build-time official stable release, verified against its SHA-256 manifest | [Unlicense for yt-dlp itself](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE); [release/source](https://github.com/yt-dlp/yt-dlp/releases). Bundled dependencies retain their own upstream licenses. |
| FFmpeg and native libraries distributed by youtubedl-android | FFmpeg 7.1.1; ARM64 build | The actual bundled `libavcodec` configuration includes `--enable-gpl` and `--enable-version3`; this is a GPL-enabled build, **not an LGPL-only FFmpeg build**. [FFmpeg licensing](https://ffmpeg.org/legal.html); [7.1.1 source](https://github.com/FFmpeg/FFmpeg/tree/n7.1.1); [wrapper build instructions](https://github.com/yausername/youtubedl-android/blob/0.18.1/BUILD_FFMPEG.md); [Termux build recipes](https://github.com/termux/termux-packages/tree/master/packages/ffmpeg). |
| Python runtime distributed by youtubedl-android | 3.12.11 | [PSF License Version 2 and incorporated notices](https://github.com/python/cpython/blob/v3.12.11/LICENSE); [runtime build instructions](https://github.com/yausername/youtubedl-android/blob/0.18.1/BUILD_PYTHON.md) |
| QuickJS runtime distributed by youtubedl-android | Bundled with 0.18.1 | [QuickJS upstream](https://bellard.org/quickjs/), [QuickJS-NG MIT license](https://github.com/quickjs-ng/quickjs/blob/master/LICENSE); [wrapper integration](https://github.com/yausername/youtubedl-android/pull/338) |
| Kotlin runtime, AndroidX, Jackson, Apache Commons IO and Commons Compress | Resolved versions recorded by Gradle | Apache License 2.0; original notices remain applicable. Source: [Kotlin](https://github.com/JetBrains/kotlin), [AndroidX](https://android.googlesource.com/platform/frameworks/support/), [Jackson](https://github.com/FasterXML/jackson-databind), [Commons IO](https://github.com/apache/commons-io), [Commons Compress](https://github.com/apache/commons-compress). |

The full GPL text and principal runtime license texts are packaged in `android/app/src/main/assets/licenses/`. The FFmpeg configure string was extracted from the actual Maven Central ARM64 AAR and is included as `licenses/FFmpeg-build-config.txt`. It identifies enabled libraries such as `libmp3lame`, `libx264`, and `libx265`; those libraries retain their own licenses.

## Corresponding source

The Android application directly links a GPL-3.0 library. The combined Android release is distributed under GPL-compatible terms, with its application source and build scripts in [Cloud-Music](https://github.com/wrench1997/Cloud-Music). Each Android release identifies its application source revision and provides a source archive alongside the APK. The application-specific license grant accompanies those sources; the licenses and copyrights of the components above remain unchanged.

The application's Android and shared frontend sources, Gradle configuration, and media-engine installation script are included in that archive. The wrapper source is identified by its 0.18.1 tag; its native-runtime build instructions and the FFmpeg 7.1.1 source are linked above. The packaged configure string records the actual ARM64 FFmpeg build. The wrapper distributes native prebuilts and refers to Termux build recipes without recording every dependency's recipe revision, so these references do not establish a bit-for-bit reproducible rebuild of those prebuilts.

Cloud-Music adds a Capacitor bridge, a persistent serial download queue, foreground transfer notifications, validated MP3 file handling, and account-bound Drive uploads. It does not modify upstream FFmpeg or Python binaries. The generated yt-dlp resource is replaced only after verifying the official release checksum; its bundled digest changes when the application update supplies a different engine.

No warranty is provided by the upstream components except where separately agreed. This document accompanies, and does not replace, their full license texts.
