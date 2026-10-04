# Android distribution license

The original Cloud-Music application code used to build the Android distribution
(the `android/` application, the shared `src/` interface and application logic,
and their build scripts) is distributed under the GNU General Public License,
version 3 or any later version. Copyright remains with the respective authors.

You may copy, modify and redistribute that code under those terms. It is
provided without warranty, including implied merchantability or fitness for a
particular purpose. The complete license is in
[`android/app/src/main/assets/licenses/GPL-3.0.txt`](android/app/src/main/assets/licenses/GPL-3.0.txt).

Third-party components retain their original copyrights and licenses; see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). This statement does not
relicense Google, Android system components or other third-party code.

Each Android release identifies its matching Git tag and publishes the
application source ZIP alongside the APK. The ZIP contains the tracked
application code, dependency declarations and build scripts; dependency
sources, native build instructions and the extracted FFmpeg configuration
are identified in the third-party notices. Signing keys, personal account
credentials and personal music are excluded.
