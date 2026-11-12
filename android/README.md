# 홈포인트 네비 안드로이드 앱

HOME POINT NAVI(https://sistech.dpdns.org)를 여는 안드로이드 앱입니다. 앱 안에서 실제 사이트를 웹뷰(앱 속 브라우저)로 보여 줍니다. 웹 화면(`public/`)은 그대로이고, 웹 버전도 전과 같이 쓸 수 있습니다.

사이트를 배포하면 앱에도 바로 반영됩니다. 새 APK는 앱 자체(껍데기)가 바뀔 때만 만듭니다.

## 앱 정보

| 항목 | 값 |
| --- | --- |
| 앱 이름 | 홈포인트 네비 |
| 패키지 이름 | `org.dpdns.sistech.homepoint` (나중에 바꿀 수 없습니다). 점검용은 끝에 `.debug`가 붙습니다. |
| 버전 | versionCode 3, versionName 1.0.2 (`app/build.gradle.kts`) |
| 지원 | 안드로이드 8.0 이상(minSdk 26), targetSdk·compileSdk 35 |
| 아이콘 | 사이트 지도 핀과 같은 빨간 핀, 흰 바탕(적응형 아이콘, 벡터, 테마 아이콘용 한 색 핀 포함) |
| 빌드 도구 | AGP 8.13.2, Kotlin 2.2.21, Gradle 래퍼 8.14.3, JDK 17 |

`local.properties`에 안드로이드 SDK 위치(`sdk.dir`)가 들어 있고, 깃에는 올리지 않습니다.

## 웹 버전과 다른 점

앱이 사이트 위에 더해 주는 것입니다. 코드는 `app/src/main/.../MainActivity.kt`와 `assets/`에 있습니다.

| 기능 | 앱에서의 동작 |
| --- | --- |
| CSV 가져오기 | 파일 선택 칸이 휴대폰의 문서 선택 화면을 엽니다. 여러 파일을 고를 수 있습니다. |
| CSV 내보내기 | `assets/bridge.js`가 사이트의 내려받기를 가로채 휴대폰 다운로드 폴더에 저장합니다(안드로이드 10 이상. 9 이하는 저장할 곳을 직접 고릅니다). 저장 뒤 "저장했습니다 [공유] [확인]"이 뜹니다. 같은 이름이 있으면 `이름 (1).csv`로 저장합니다. |
| 확인·알림창 | 사이트의 confirm()/alert()가 휴대폰 기본 대화상자로 뜹니다. |
| 바깥 링크 | 카카오맵에서 보기, kakaomap:// 길찾기, 새 창은 카카오맵 앱이나 외부 브라우저에서 엽니다. 누르지 않았는데 열리는 새 창과 페이지 속 틀(iframe)이 앱을 여는 것은 막습니다. |
| 뒤로 가기 | `assets/back.js`가 한 번에 하나씩 닫습니다: 내보내기 메뉴 → 미션 기록 창 → ☰ 메뉴 → 계정 관리 → 상세 정보. 열린 것이 없으면 앱을 끄지 않고 뒤로 보냅니다(로그인과 적던 내용 유지). |
| 화면 돌리기·키보드 | 화면 돌리기, 키보드, 글자 크기·화면 배율·언어 변경에도 화면을 다시 불러오지 않습니다. 키보드가 입력 칸을 가리지 않습니다. |
| 떠날까요? 확인 | 사이트의 "저장하지 않은 내용이 있습니다"(beforeunload) 확인은 묻지 않고 넘깁니다. 메모를 쓰던 중 길찾기를 눌러도 영어 확인 창에 막히지 않습니다. 메모는 사이트가 화면을 벗어날 때 저장합니다. |
| 현위치 | 사이트의 [현위치]를 누를 때만 안드로이드 위치 권한을 묻습니다(앱을 켤 때는 묻지 않음). 정확한 위치와 대략적인 위치 중 어느 쪽만 허용해도 됩니다. 위치는 이 사이트 주소(`sistech.dpdns.org`)에만 주고, 다른 주소나 틀(iframe)이 요청하면 묻지 않고 거절합니다. 허용을 앱이 따로 기억하지 않아, 끄려면 휴대폰 설정 → 앱 → 홈포인트 네비 → 권한 → 위치에서 "허용 안 함"으로 바꾸면 바로 적용됩니다. 백그라운드 위치는 쓰지 않습니다. |
| 연결 실패 | 처음 불러오기가 실패하면(인터넷 없음) "연결할 수 없습니다 [다시 시도]" 화면이 나옵니다. |
| 로그인 정보 | 클라우드 백업과 기기 이전에서 제외합니다. |
| 사용자 에이전트 | 끝에 ` HomePointNavi/<버전>`(지금은 1.0.2)이 붙습니다. |

## 만들기

`android/` 안에서 실행합니다.

```bash
./gradlew assembleDebug     # 점검용
./gradlew assembleRelease   # 배포용(서명됨)
```

| 종류 | 결과 파일 |
| --- | --- |
| 점검용 | `app/build/outputs/apk/debug/app-debug.apk` |
| 배포용 | `app/build/outputs/apk/release/app-release.apk` |

- 나눠 줄 파일은 배포용입니다. 배포용 복사본은 `android/release/HomePointNavi-1.0.2.apk`에 둡니다(깃에 올리지 않습니다).
- 다시 나눠 줄 때는 `app/build.gradle.kts`의 versionCode를 올려야 기존 앱 위에 설치됩니다.
- 점검용은 패키지 이름이 `org.dpdns.sistech.homepoint.debug`이고 앱 이름이 "홈포인트 네비 (점검)"입니다. 배포용과 다른 앱으로 취급되어 한 휴대폰에 나란히 설치됩니다(점검용을 지워도 배포용의 로그인·데이터는 그대로).
- 점검용만 다음을 지원합니다. `adb shell am start -n org.dpdns.sistech.homepoint.debug/org.dpdns.sistech.homepoint.MainActivity -e url http://localhost:4197/`로 다른 주소를 열 수 있고, 웹뷰 원격 디버깅이 켜져 있습니다. 바꿀 수 있는 주소는 http·https이면서 호스트가 `localhost`, `127.0.0.1`, `10.0.2.2`, 사이트 주소(`sistech.dpdns.org`)인 것뿐이고, 그 밖의 주소는 무시하고 사이트를 엽니다. 점검용은 localhost, 127.0.0.1, 10.0.2.2에 한해 http를 허용합니다. 배포용은 둘 다 무시합니다.

## 서명 열쇠와 보관

배포용 앱은 열쇠 파일로 서명합니다.

- 열쇠 파일: `android/homepoint-release.jks`
- 비밀번호와 별칭 정보: `android/keystore.properties`
- 저장소가 공개라서 두 파일 모두 깃에서 제외되어 있습니다.

**두 파일을 비밀번호 관리자나 비공개 드라이브 같은 안전한 곳에 꼭 따로 보관하세요. 잃어버리면 이미 설치된 앱을 덮어서 업데이트할 수 없고, 모두가 앱을 지우고 다시 설치해야 합니다.**

`keystore.properties`가 없으면 배포용 빌드가 서명 없이 만들어져 설치할 수 없습니다.

### 새 열쇠를 만들어야 할 때

처음부터 다시 시작할 때만 합니다. 기존 앱과는 다른 앱으로 취급됩니다.

```bash
keytool -genkeypair -v -keystore homepoint-release.jks -alias homepoint \
  -keyalg RSA -keysize 2048 -validity 10000
```

비밀번호와 이름은 물어보는 대로 입력합니다. 그다음 `android/keystore.properties`를 아래 형식으로 만듭니다(`<…>` 자리는 실제 값으로 바꿉니다).

```
storeFile=homepoint-release.jks
storePassword=<비밀번호>
keyAlias=homepoint
keyPassword=<비밀번호>
```

## 휴대폰에 설치하기

1. `HomePointNavi-1.0.2.apk`를 카카오톡이나 드라이브로 보냅니다.
2. 휴대폰에서 파일을 연 앱(카카오톡, 드라이브 등)에 '출처를 알 수 없는 앱 설치'를 허용합니다.
3. 설치합니다.

업데이트는 같은 열쇠로 서명하고 versionCode를 올린 새 APK를 기존 앱 위에 설치하면 됩니다. 로그인은 유지됩니다.

처음 실제 휴대폰에서 확인할 것: 로그인, 지도, 카카오맵 길찾기가 카카오맵 앱을 여는지, 내보내기·가져오기. (실제 카카오맵 앱과 실제 계정 로그인은 에뮬레이터 점검에서 해 보지 못했습니다.)

## 에뮬레이터 점검

`e2e/check.mjs`가 앱을 설치해 실제처럼 눌러 보며 확인합니다.

```bash
(cd android && ./gradlew assembleDebug) && node android/e2e/check.mjs
```

- 실행 중인 에뮬레이터나 USB 디버깅을 켠 휴대폰이 하나 있어야 합니다.
- 일부만 돌리려면 `ONLY=back,export,import,external,beforeunload,keyboard,rotate,location,offline`처럼 항목을 적습니다.
- 루트 `e2e/`의 가짜 supabase·가짜 카카오를 웹뷰 원격 디버깅으로 끼워 넣습니다. `e2e/serve.mjs`가 4197 포트로 `public/`을 서빙하고(가짜 config.js 사용, 실제 `public/config.js`는 건드리지 않음), 점검용 앱(`.debug`)을 지웠다 다시 설치합니다. 배포용 앱은 건드리지 않습니다. 실제 계정은 쓰지 않습니다.
- 현재 68개 항목(현위치 17개 포함): 로그인·목록 표시와 화면 여백, 뒤로 가기 순서, 확인창 취소·확인, 다운로드 폴더 내보내기·공유·`(1)` 이름·미션 CSV 머리글, 문서 선택 화면으로 가져오기(취소 후 다시 열기), 바깥 링크, 메모를 쓰던 중 길찾기(떠날까요? 창 없음), 키보드, 화면 돌리기, 앱이 죽지 않는지, 오프라인 다시 시도.
- `location` 항목은 권한 창(허용·거절·미리 허용·이미 떠 있을 때 두 번째 요청)과 사이트 주소가 아닌 틀(127.0.0.1)의 거절을 확인합니다. 에뮬레이터는 `enableHighAccuracy: true`로 요청해야 `adb emu geo fix` 좌표가 들어옵니다(대략적 위치(fused)는 좌표를 주지 않음). 실제 휴대폰은 상관없습니다.
- 스크린샷은 `e2e/shots/`에 저장됩니다(깃 제외).
- 확인한 에뮬레이터는 Medium_Phone_API_35(안드로이드 15)입니다.

## 사이트를 고칠 때 주의

`assets/back.js`가 사이트의 다음 이름에 기대고 있습니다: `#export-menu`, `dialog`, `.topbar.menu-open`, `#accounts-panel`, `#detail`. 사이트에서 이 id·클래스를 바꾸거나 새 창을 추가하면 뒤로 가기가 어긋나므로 `back.js`도 함께 확인하고 에뮬레이터 점검을 돌리세요.
