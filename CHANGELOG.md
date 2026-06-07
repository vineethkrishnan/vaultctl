# Changelog

## [1.17.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.16.0...v1.17.0) (2026-06-07)


### Features

* **vault:** shared org vaults from the ui and step-up-gated vault deletion ([#219](https://github.com/vineethkrishnan/vaultctl/issues/219)) ([649a054](https://github.com/vineethkrishnan/vaultctl/commit/649a0542647bfed7b819fa9148d05358f64f40bf))


### Bug Fixes

* **compose:** persist local backups across container recreates ([#217](https://github.com/vineethkrishnan/vaultctl/issues/217)) ([b1f2e87](https://github.com/vineethkrishnan/vaultctl/commit/b1f2e87f5a655ce849bd90b0811d3ab13240df1d))
* **extension:** delay autofill on page load so late-rendered forms get filled ([#220](https://github.com/vineethkrishnan/vaultctl/issues/220)) ([dad6b17](https://github.com/vineethkrishnan/vaultctl/commit/dad6b17a8656e5a82f1d8fdca569deafdaa929e2))
* **extension:** guard delayed autofill against user input and refresh matches on unlock ([#221](https://github.com/vineethkrishnan/vaultctl/issues/221)) ([057db98](https://github.com/vineethkrishnan/vaultctl/commit/057db984c8e7dfa113ced1448bd80b625f53b36c))


### CI/CD

* pull the postgres service image from the ecr public mirror ([#222](https://github.com/vineethkrishnan/vaultctl/issues/222)) ([8e7f677](https://github.com/vineethkrishnan/vaultctl/commit/8e7f677080921ff315f1802eb29b95baefb1fcae))

## [1.16.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.15.0...v1.16.0) (2026-06-06)


### Features

* **digest:** per-user timezone and granular schedule for email digests ([#213](https://github.com/vineethkrishnan/vaultctl/issues/213)) ([36266d8](https://github.com/vineethkrishnan/vaultctl/commit/36266d82e4f25b3e0b8bcb163da2206c92258896))
* **extension:** detect, capture, and fill credit-card and identity forms ([#215](https://github.com/vineethkrishnan/vaultctl/issues/215)) ([f7b3f4a](https://github.com/vineethkrishnan/vaultctl/commit/f7b3f4a1cced7b13ab495c60c8e62c1bdf98a7d5))
* **extension:** multi-vault switcher, cross-vault autofill, and save target ([#211](https://github.com/vineethkrishnan/vaultctl/issues/211)) ([ea0935f](https://github.com/vineethkrishnan/vaultctl/commit/ea0935fa356d03e092048f3d03c8f87e622d867d))


### Bug Fixes

* **web:** session restore, settings reorg, tooltips, and create-vault ([#212](https://github.com/vineethkrishnan/vaultctl/issues/212)) ([791768a](https://github.com/vineethkrishnan/vaultctl/commit/791768a6d185637d5f2a8a5d96001c40dfb1dfac))


### Documentation

* configuration reference, email and backup guides, feature overview ([#216](https://github.com/vineethkrishnan/vaultctl/issues/216)) ([90d285c](https://github.com/vineethkrishnan/vaultctl/commit/90d285c9cf6578395dc62ba0c194ad6ff335dcfc))

## [1.15.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.14.0...v1.15.0) (2026-06-06)


### Features

* **api:** config feature flags, login-alert opt-out, and self-audit endpoint ([#203](https://github.com/vineethkrishnan/vaultctl/issues/203)) ([89db344](https://github.com/vineethkrishnan/vaultctl/commit/89db3442b4928e2c8e75823cb00b2da9c4bdc034))
* **api:** enforce require-2fa, add orgs list and hibp flag ([#207](https://github.com/vineethkrishnan/vaultctl/issues/207)) ([b6f3d6e](https://github.com/vineethkrishnan/vaultctl/commit/b6f3d6e3eda5ee16086edc2af5a7ac1f9a0dac1a))
* **email:** localize transactional mail (en/de) by user locale ([#209](https://github.com/vineethkrishnan/vaultctl/issues/209)) ([b4c90d2](https://github.com/vineethkrishnan/vaultctl/commit/b4c90d2f2ed6b78db2f4bd9437296aa1f93ebea1))
* **web:** activity log view and server-feature gating ([#206](https://github.com/vineethkrishnan/vaultctl/issues/206)) ([4aac0c0](https://github.com/vineethkrishnan/vaultctl/commit/4aac0c07500e0cf0d8806e954df6fc31c803cff1))
* **web:** live totp codes, password health view, and csv export ([#204](https://github.com/vineethkrishnan/vaultctl/issues/204)) ([534b14f](https://github.com/vineethkrishnan/vaultctl/commit/534b14f7833d73a87a8b14e1f19db017ad6c1982))
* **web:** onboarding checklist, admin org list, and hibp breach check ([#208](https://github.com/vineethkrishnan/vaultctl/issues/208)) ([ac76dc5](https://github.com/vineethkrishnan/vaultctl/commit/ac76dc548d0afb369a4210bff539c9cd0b8c921e))
* **web:** real vault sharing with recipient key-wrap ([#210](https://github.com/vineethkrishnan/vaultctl/issues/210)) ([a8a08b5](https://github.com/vineethkrishnan/vaultctl/commit/a8a08b58413cb95ec1cacfc54a3f8be474e46e3b))


### Bug Fixes

* **email:** harden otp, mailer, digest, and login-alert paths ([#201](https://github.com/vineethkrishnan/vaultctl/issues/201)) ([7cfaf78](https://github.com/vineethkrishnan/vaultctl/commit/7cfaf78cb039fd83d7ae7ee88edef6d1d8b436af))
* **extension:** validate message senders and harden autofill ([#200](https://github.com/vineethkrishnan/vaultctl/issues/200)) ([bda3a38](https://github.com/vineethkrishnan/vaultctl/commit/bda3a38b215e07a32448db1847ad84feffdb36e6))
* **web:** repair auto-lock, item-name overwrite, i18n gaps, a11y, and ux polish ([#202](https://github.com/vineethkrishnan/vaultctl/issues/202)) ([9f2ace8](https://github.com/vineethkrishnan/vaultctl/commit/9f2ace83822d35451031b2563f8ebb58e5a099af))

## [1.14.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.13.0...v1.14.0) (2026-06-05)


### Features

* **email:** pluggable mailer, signup OTP verification, login alerts, and activity digests ([#196](https://github.com/vineethkrishnan/vaultctl/issues/196)) ([f5e056c](https://github.com/vineethkrishnan/vaultctl/commit/f5e056c98e4e4ab85db9780d5ebda15d52289311))
* **extension:** clearer unreachable-server errors, DB-aware health, and update-delay fix ([#199](https://github.com/vineethkrishnan/vaultctl/issues/199)) ([d70d5f8](https://github.com/vineethkrishnan/vaultctl/commit/d70d5f8e6c00cf97300388a80348c4e36392cc1b))
* surface update alerts in notification areas and keep the save toast alive across redirects ([#194](https://github.com/vineethkrishnan/vaultctl/issues/194)) ([c56dbb3](https://github.com/vineethkrishnan/vaultctl/commit/c56dbb3851a877d965687f88d01deaa83cef7c3d))
* **web:** english + german i18n across web and extension ([#197](https://github.com/vineethkrishnan/vaultctl/issues/197)) ([bec95df](https://github.com/vineethkrishnan/vaultctl/commit/bec95df803e243b9dcc37594e8e4d2be74458e26))

## [1.13.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.12.1...v1.13.0) (2026-06-04)


### Features

* surface update alerts in notification areas and keep the save toast alive across redirects ([#192](https://github.com/vineethkrishnan/vaultctl/issues/192)) ([a32dffb](https://github.com/vineethkrishnan/vaultctl/commit/a32dffbad6a39eae430c4897850f917262106305))

## [1.12.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.12.0...v1.12.1) (2026-06-04)


### Build System

* unify platform versions via release-please extra-files ([#190](https://github.com/vineethkrishnan/vaultctl/issues/190)) ([b45ff34](https://github.com/vineethkrishnan/vaultctl/commit/b45ff3478b9f150eb6d7b2f313195944cf8a7ff6))

## [1.12.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.11.0...v1.12.0) (2026-06-03)


### Features

* **web:** mobile-first notifications page with day grouping ([#187](https://github.com/vineethkrishnan/vaultctl/issues/187)) ([66ca003](https://github.com/vineethkrishnan/vaultctl/commit/66ca0036b99be8c5004e6bcd1dfd250ffbdb8495))
* **web:** rich profile menu + quick-actions row (sidebar + mobile) ([#186](https://github.com/vineethkrishnan/vaultctl/issues/186)) ([c3f0482](https://github.com/vineethkrishnan/vaultctl/commit/c3f048206530207928abb70e781fc92ef46babbb))


### Bug Fixes

* **extension:** bold the username in autofill suggestions ([#183](https://github.com/vineethkrishnan/vaultctl/issues/183)) ([787ead8](https://github.com/vineethkrishnan/vaultctl/commit/787ead8fb56c3496d8296492710b6b6f9fca84f3))
* **extension:** pick the real username field, not the 2fa/code field ([#189](https://github.com/vineethkrishnan/vaultctl/issues/189)) ([9e2612b](https://github.com/vineethkrishnan/vaultctl/commit/9e2612bde04be743e345565b83a960858cf0c628))
* **web:** clearer recovery dead-ends and stronger "don't lose the kit" warnings ([#188](https://github.com/vineethkrishnan/vaultctl/issues/188)) ([87ff06b](https://github.com/vineethkrishnan/vaultctl/commit/87ff06b307cf9b0699b45095fe66855b395a942a))


### Documentation

* **faq:** explain chrome's duplicate password dropdown in the extension ([#185](https://github.com/vineethkrishnan/vaultctl/issues/185)) ([8df6ab6](https://github.com/vineethkrishnan/vaultctl/commit/8df6ab61987ce4236b0b4ee7eec5d2e382a97c67))

## [1.11.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.10.0...v1.11.0) (2026-06-03)


### Features

* **extension:** update check, what's-new, and version sync ([#182](https://github.com/vineethkrishnan/vaultctl/issues/182)) ([619009b](https://github.com/vineethkrishnan/vaultctl/commit/619009be59ccf1ef1c517da005f2bd8431713b79))
* **server:** update-check and audit-backed notification api ([#178](https://github.com/vineethkrishnan/vaultctl/issues/178)) ([c4c02bb](https://github.com/vineethkrishnan/vaultctl/commit/c4c02bbcc053e6c1607ac61891760df2930ea3b5))
* **web:** update banner, what's-new, and notification centre ([#179](https://github.com/vineethkrishnan/vaultctl/issues/179)) ([e705b7c](https://github.com/vineethkrishnan/vaultctl/commit/e705b7ce81de65faa3536dd62f9c100c2bbedae5))


### Bug Fixes

* **extension:** keep the autofill picker open on focus and suppress native dropdown on both fields ([#177](https://github.com/vineethkrishnan/vaultctl/issues/177)) ([162cb49](https://github.com/vineethkrishnan/vaultctl/commit/162cb49a616cbfbc336efb6b98f117760bef90cd))


### CI/CD

* bump go to 1.26.4 for the net/textproto and crypto/x509 fixes ([#180](https://github.com/vineethkrishnan/vaultctl/issues/180)) ([0e8b980](https://github.com/vineethkrishnan/vaultctl/commit/0e8b9802a91a9a885e28cafdd3d790aa21015309))

## [1.10.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.9.0...v1.10.0) (2026-06-02)


### Features

* **extension:** google-style autofill picker — exact origin, persistent icon, masked password ([#175](https://github.com/vineethkrishnan/vaultctl/issues/175)) ([44e54b0](https://github.com/vineethkrishnan/vaultctl/commit/44e54b0f45feb656988088f52635f1aac97b699f))

## [1.9.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.8.0...v1.9.0) (2026-06-02)


### Features

* **extension:** show site favicon and username in autofill suggestions ([#174](https://github.com/vineethkrishnan/vaultctl/issues/174)) ([6780de6](https://github.com/vineethkrishnan/vaultctl/commit/6780de6c2cd3e49f0ed8b7b92bb61111c9f76144))
* working master-password recovery via the recovery kit ([#171](https://github.com/vineethkrishnan/vaultctl/issues/171)) ([d6efe6d](https://github.com/vineethkrishnan/vaultctl/commit/d6efe6d44ea6e9398a77e14c732d299afda8c5aa))


### Bug Fixes

* **extension:** scope autofill suggestions to the matching site ([#169](https://github.com/vineethkrishnan/vaultctl/issues/169)) ([3e6e748](https://github.com/vineethkrishnan/vaultctl/commit/3e6e74830b0662902d69673f344467c2d1a1ee19))
* **web:** explain biometric unlock when a device lacks prf support ([#170](https://github.com/vineethkrishnan/vaultctl/issues/170)) ([bc3a36e](https://github.com/vineethkrishnan/vaultctl/commit/bc3a36e7a53caf47ad6ebc1ef9d4a7837ccae806))


### CI/CD

* pin gosec and exclude already-justified rules to unbreak the scan ([#172](https://github.com/vineethkrishnan/vaultctl/issues/172)) ([b3f899a](https://github.com/vineethkrishnan/vaultctl/commit/b3f899a5f63b66f6d7a2fffcc34b87a2727dd10a))

## [1.8.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.7.1...v1.8.0) (2026-06-01)


### Features

* add touch id unlock and default to unlock-until-browser-close ([#162](https://github.com/vineethkrishnan/vaultctl/issues/162)) ([f9f518f](https://github.com/vineethkrishnan/vaultctl/commit/f9f518f4353bc2b2018269866face4c51d78d873))
* per-user scheduled encrypted backup & sync (local, S3, WebDAV, Drive, Dropbox, OneDrive) ([#164](https://github.com/vineethkrishnan/vaultctl/issues/164)) ([baae0f5](https://github.com/vineethkrishnan/vaultctl/commit/baae0f5d7870d858e79c118f23e2c91376b2179f))
* seed default folders on registration ([#165](https://github.com/vineethkrishnan/vaultctl/issues/165)) ([6f71493](https://github.com/vineethkrishnan/vaultctl/commit/6f71493c665d43831634abc900868d160486f5a3))
* web touch id unlock + step-up, and fix the 2fa step-up prompt ([#168](https://github.com/vineethkrishnan/vaultctl/issues/168)) ([d93d1ef](https://github.com/vineethkrishnan/vaultctl/commit/d93d1efd02412054bf904724126f73696e9c41c5))


### Bug Fixes

* only failed logins count toward the per-email rate limit, reset on success ([#167](https://github.com/vineethkrishnan/vaultctl/issues/167)) ([d0e338b](https://github.com/vineethkrishnan/vaultctl/commit/d0e338ba2d35c264a05cfd84d42d4cdf0099d9f5))
* remember the email on multi-step login so the password step saves with it ([#166](https://github.com/vineethkrishnan/vaultctl/issues/166)) ([f28ee5d](https://github.com/vineethkrishnan/vaultctl/commit/f28ee5d43b2a43cac1b9620784e314e957a668ea))


### CI/CD

* **deps:** bump the actions group with 7 updates ([#161](https://github.com/vineethkrishnan/vaultctl/issues/161)) ([858d30a](https://github.com/vineethkrishnan/vaultctl/commit/858d30ab05f9dce9ced3ba097d58a88f6a48ce75))

## [1.7.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.7.0...v1.7.1) (2026-05-31)


### Bug Fixes

* anchor the confirm dialog near the top of the viewport ([#147](https://github.com/vineethkrishnan/vaultctl/issues/147)) ([91234f7](https://github.com/vineethkrishnan/vaultctl/commit/91234f70928fcf859d22a1a4b2ca87c245e4a564))

## [1.7.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.6.2...v1.7.0) (2026-05-31)


### Features

* morph the save toast into a success or error state ([#145](https://github.com/vineethkrishnan/vaultctl/issues/145)) ([b80b1eb](https://github.com/vineethkrishnan/vaultctl/commit/b80b1eb179aa7a1acf7a760289f6274dc33ec15b))
* vault list filtering, per-row metadata, and a quick-actions menu ([#144](https://github.com/vineethkrishnan/vaultctl/issues/144)) ([4084239](https://github.com/vineethkrishnan/vaultctl/commit/40842396e9d58fd5a8fe43f70d193d2678b0fe5c))


### Bug Fixes

* keep the extension signed in by refreshing the access token ([#143](https://github.com/vineethkrishnan/vaultctl/issues/143)) ([199f659](https://github.com/vineethkrishnan/vaultctl/commit/199f659326f8994468e3659a9ca7c8ebcc99525b))
* permanent delete from trash works, with a themed confirm dialog ([#146](https://github.com/vineethkrishnan/vaultctl/issues/146)) ([02da572](https://github.com/vineethkrishnan/vaultctl/commit/02da57229da7e723534f0cb8749bbfee8a68b462))
* saving a captured login from the alerts tab writes it to the vault ([#141](https://github.com/vineethkrishnan/vaultctl/issues/141)) ([47d5484](https://github.com/vineethkrishnan/vaultctl/commit/47d548478521d0c30fdd46fa95153418f579822d))

## [1.6.2](https://github.com/vineethkrishnan/vaultctl/compare/v1.6.1...v1.6.2) (2026-05-31)


### CI/CD

* deploy docs to the project the custom domain serves, on every docs change ([#139](https://github.com/vineethkrishnan/vaultctl/issues/139)) ([e932f73](https://github.com/vineethkrishnan/vaultctl/commit/e932f73df422e4ca5e02c6a0bf01c9c38f66bba1))

## [1.6.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.6.0...v1.6.1) (2026-05-31)


### Documentation

* restore the docker pulls badge now that the hub repo is public ([#137](https://github.com/vineethkrishnan/vaultctl/issues/137)) ([9c54990](https://github.com/vineethkrishnan/vaultctl/commit/9c54990a403dce57fcc44d6a5899e49b0fa300da))

## [1.6.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.5.0...v1.6.0) (2026-05-31)


### Features

* about panel with build and license transparency ([#109](https://github.com/vineethkrishnan/vaultctl/issues/109)) ([75201f7](https://github.com/vineethkrishnan/vaultctl/commit/75201f7633cc9ae94a19edcdca4f0841206dd342))
* add a notifications tab to the extension and fix the phantom badge ([#128](https://github.com/vineethkrishnan/vaultctl/issues/128)) ([d27a04f](https://github.com/vineethkrishnan/vaultctl/commit/d27a04fe9d15290b2feffb4dfa0ca2f967bae6c7))
* brand wordmark, geist typography, and full login logo ([#108](https://github.com/vineethkrishnan/vaultctl/issues/108)) ([7878bec](https://github.com/vineethkrishnan/vaultctl/commit/7878bec198a4759bcb76b17f33350fb11d84bf8f))
* **brand:** wire vaultctl logo and icons across web and extension ([#106](https://github.com/vineethkrishnan/vaultctl/issues/106)) ([79a43a6](https://github.com/vineethkrishnan/vaultctl/commit/79a43a628a285571997315936c853a39d0ea9cac))
* collapse sessions per device and add mobile drawer layout ([#113](https://github.com/vineethkrishnan/vaultctl/issues/113)) ([27fa520](https://github.com/vineethkrishnan/vaultctl/commit/27fa520dd24bc750d13a9f82b329cd1363d6182d))
* encrypted item attachments (filesystem blob store) ([#104](https://github.com/vineethkrishnan/vaultctl/issues/104)) ([680b8de](https://github.com/vineethkrishnan/vaultctl/commit/680b8ded92f50c77510111c2f343a246bdeaea0c))
* extension inline autofill and save/update prompts ([#116](https://github.com/vineethkrishnan/vaultctl/issues/116)) ([bb58ecc](https://github.com/vineethkrishnan/vaultctl/commit/bb58ecc8d8e2dccb8bbe7b7c5bd62f85f2ddc86e))
* **extension:** polish popup with brand accent and motion ([#101](https://github.com/vineethkrishnan/vaultctl/issues/101)) ([58e8cc6](https://github.com/vineethkrishnan/vaultctl/commit/58e8cc6d6d0384dbd434a144c1b2051f7542f410))
* **extension:** wire popup to fetch and decrypt vault items ([#103](https://github.com/vineethkrishnan/vaultctl/issues/103)) ([3ba16cd](https://github.com/vineethkrishnan/vaultctl/commit/3ba16cdf18aa6af0b787f24f3421da8fa607b741))
* inter ui font and a brand emblem font glyph ([#124](https://github.com/vineethkrishnan/vaultctl/issues/124)) ([28ca8a6](https://github.com/vineethkrishnan/vaultctl/commit/28ca8a6e35863c947953f131b2d19c9dbce28be2))
* preset folder suggestions for quick organization ([#118](https://github.com/vineethkrishnan/vaultctl/issues/118)) ([3c054d2](https://github.com/vineethkrishnan/vaultctl/commit/3c054d218a4f208fb600c10ca0c8942d71768446))
* readable session device labels, current-first, dedupe about title ([#114](https://github.com/vineethkrishnan/vaultctl/issues/114)) ([676053b](https://github.com/vineethkrishnan/vaultctl/commit/676053b7db08df176dc5033b71f8458b93e06413))
* readable tagline on the login screen ([#123](https://github.com/vineethkrishnan/vaultctl/issues/123)) ([bee2b85](https://github.com/vineethkrishnan/vaultctl/commit/bee2b85355690b64944d457519bb92bce8b19f8f))
* remember email for faster unlock on web and extension ([#120](https://github.com/vineethkrishnan/vaultctl/issues/120)) ([234264e](https://github.com/vineethkrishnan/vaultctl/commit/234264e0b45a67c59e8dbdaa02078cce12451638))
* render the brand wordmark and emblem from the font on the about and login screens ([#127](https://github.com/vineethkrishnan/vaultctl/issues/127)) ([07eb004](https://github.com/vineethkrishnan/vaultctl/commit/07eb00418ba9baecce77b827c0dae44278170032))
* strong-password suggestions and generated-password history ([#121](https://github.com/vineethkrishnan/vaultctl/issues/121)) ([da76b51](https://github.com/vineethkrishnan/vaultctl/commit/da76b51b048c1d9b97bb6da9929b8b07be329525))
* tabbed settings layout and clearer about panel ([#111](https://github.com/vineethkrishnan/vaultctl/issues/111)) ([f77b9f3](https://github.com/vineethkrishnan/vaultctl/commit/f77b9f32e7a2587b202f10e0af9d0c5de1a2ba44))
* **web:** smoother motion and card-based vault layout ([#100](https://github.com/vineethkrishnan/vaultctl/issues/100)) ([89e18ca](https://github.com/vineethkrishnan/vaultctl/commit/89e18ca470fce91d0f3a3e046da13725de553fc8))


### Bug Fixes

* add hint to the prompt-timeout setting in the extension ([#119](https://github.com/vineethkrishnan/vaultctl/issues/119)) ([2762606](https://github.com/vineethkrishnan/vaultctl/commit/276260601bcb6bace349a695a5d42abd83b6d2ea))
* do not capture logins already saved in the vault ([#126](https://github.com/vineethkrishnan/vaultctl/issues/126)) ([75b9735](https://github.com/vineethkrishnan/vaultctl/commit/75b9735e34a56016e7ff8eb7bbc622b0c1cd1ce4))
* extension capture/search and session list polish ([#125](https://github.com/vineethkrishnan/vaultctl/issues/125)) ([0cd1e9e](https://github.com/vineethkrishnan/vaultctl/commit/0cd1e9e1d4d868a4132226e595c5d0e462525eed))
* log out from the vault sidebar revokes the session and redirects to login ([#134](https://github.com/vineethkrishnan/vaultctl/issues/134)) ([29489fb](https://github.com/vineethkrishnan/vaultctl/commit/29489fbcb52142d3eeaa8ee9e7a98bac0e875927))
* mobile form grids, modal padding, and a bolder extension icon ([#115](https://github.com/vineethkrishnan/vaultctl/issues/115)) ([caaa46d](https://github.com/vineethkrishnan/vaultctl/commit/caaa46d1268777932fa38b7c94c23e89a56ac426))
* move extension save toast to top-right with a slide-in ([#117](https://github.com/vineethkrishnan/vaultctl/issues/117)) ([3c9960d](https://github.com/vineethkrishnan/vaultctl/commit/3c9960dbf27c0e67118b871dc00c457cf1ecddd4))
* persist the captured-login queue so clear and mark-read stick ([#129](https://github.com/vineethkrishnan/vaultctl/issues/129)) ([98a481d](https://github.com/vineethkrishnan/vaultctl/commit/98a481dceadede1b21b0fa273313cd7c5b291b01))
* stop the content script throwing when its extension context is invalidated ([#132](https://github.com/vineethkrishnan/vaultctl/issues/132)) ([e1c1007](https://github.com/vineethkrishnan/vaultctl/commit/e1c10075a8a4d661aa23c52ceebce31ce8f2e95e))


### Documentation

* add a privacy policy and store-listing copy for the extension ([#133](https://github.com/vineethkrishnan/vaultctl/issues/133)) ([086c4ca](https://github.com/vineethkrishnan/vaultctl/commit/086c4cadcbd289586ec4786cd2797dbcca20dba9))
* add chrome web store screenshots and the generator for the extension ([#135](https://github.com/vineethkrishnan/vaultctl/issues/135)) ([19ae48d](https://github.com/vineethkrishnan/vaultctl/commit/19ae48d9e78ddc8fed44ed31f026c4218fb5ea21))
* brand the docs site and fix the release and container badges ([#136](https://github.com/vineethkrishnan/vaultctl/issues/136)) ([6b4cb11](https://github.com/vineethkrishnan/vaultctl/commit/6b4cb11df0d51efcd17ac7d91a308715dffcae54))
* correct the server config reference and document the new extension features ([#130](https://github.com/vineethkrishnan/vaultctl/issues/130)) ([4255552](https://github.com/vineethkrishnan/vaultctl/commit/4255552a11e0e73c49ac32d303430a506d026b2d))
* document attachments and the migrate-on-upgrade step ([#110](https://github.com/vineethkrishnan/vaultctl/issues/110)) ([0fc4d84](https://github.com/vineethkrishnan/vaultctl/commit/0fc4d841a1dfa0e164ec91fb673a5ab2c4e456df))
* document the remember-me login option ([#122](https://github.com/vineethkrishnan/vaultctl/issues/122)) ([e65b8c4](https://github.com/vineethkrishnan/vaultctl/commit/e65b8c4100ae2a0c859114e9f3da813b346c1958))


### CI/CD

* drop the pr-title scope allowlist ([#107](https://github.com/vineethkrishnan/vaultctl/issues/107)) ([0d80bd3](https://github.com/vineethkrishnan/vaultctl/commit/0d80bd3bfd01b037b3fe2716caed24bf7da4dfef))

## [1.5.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.4.3...v1.5.0) (2026-05-30)


### Features

* **installer:** cross-platform deps, auto-migrate, and custom loopback port ([#97](https://github.com/vineethkrishnan/vaultctl/issues/97)) ([6c1c05b](https://github.com/vineethkrishnan/vaultctl/commit/6c1c05b4943c2c0a033595da0d153989eb978cf5))
* **web:** scannable in-house qr encoder for recovery kit and totp ([#99](https://github.com/vineethkrishnan/vaultctl/issues/99)) ([c4a629b](https://github.com/vineethkrishnan/vaultctl/commit/c4a629b15c65aea3dc1dcc49fceefc57e48817c2))

## [1.4.3](https://github.com/vineethkrishnan/vaultctl/compare/v1.4.2...v1.4.3) (2026-05-25)


### Bug Fixes

* **security:** tighten cross-origin-resource-policy to same-origin ([#95](https://github.com/vineethkrishnan/vaultctl/issues/95)) ([dc58625](https://github.com/vineethkrishnan/vaultctl/commit/dc5862588441a473cd3fed0bf62e37a56a7056c9))

## [1.4.2](https://github.com/vineethkrishnan/vaultctl/compare/v1.4.1...v1.4.2) (2026-05-25)


### Bug Fixes

* **security:** validate x-forwarded-for against trusted proxies ([#93](https://github.com/vineethkrishnan/vaultctl/issues/93)) ([1e533ab](https://github.com/vineethkrishnan/vaultctl/commit/1e533ab271277aba1e01795bbb655f560097d6b6))

## [1.4.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.4.0...v1.4.1) (2026-05-17)


### Documentation

* restore docs-site link and backfill v1.4.0 changelog ([#77](https://github.com/vineethkrishnan/vaultctl/issues/77)) ([69854f9](https://github.com/vineethkrishnan/vaultctl/commit/69854f965919c257285962db3af7e01adcf6afe1))

## [1.4.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.3.1...v1.4.0) (2026-05-17)


### Features

* **auth:** bootstrap first user as owner on fresh install ([#74](https://github.com/vineethkrishnan/vaultctl/issues/74)) ([b02e1aa](https://github.com/vineethkrishnan/vaultctl/commit/b02e1aad1d3c3b7a97990516ae53b5893cd99efb))
* **web:** apply theme on first paint so pre-auth pages honor the user's preference ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))
* **web:** label every Field input via `htmlFor`/`id` for screen-reader access and automated tests ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))


### Bug Fixes

* **build:** inject the binary version into the right symbol so `make build` and `docker build` no longer report `dev (dev)` ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))
* **build:** fall back to `CHANGELOG.md` for the version when building from a source tarball without `.git` ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))
* **compose:** point `docker-compose.yml` and `docker-compose.simple.yml` at the primary GHCR registry instead of the Docker Hub mirror ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))
* **cli:** remove the non-functional `vaultctl admin init` stub now that the first-user bypass supersedes it ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))


### Documentation

* add `make` to the README development prerequisites and update the setup walkthrough screenshots ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))

## [1.3.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.3.0...v1.3.1) (2026-05-10)


### Documentation

* add docs site link to README ([68205ca](https://github.com/vineethkrishnan/vaultctl/commit/68205caa672b22b6a6feaaaf098ed2f2a7507222))

## [1.3.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.2.1...v1.3.0) (2026-05-09)


### Features

* **ci:** add playwright e2e workflow and 404 reserved server prefixes ([#59](https://github.com/vineethkrishnan/vaultctl/issues/59)) ([fe6e16d](https://github.com/vineethkrishnan/vaultctl/commit/fe6e16d26995795c5dbbd72553f304bb25af61ce))


### Bug Fixes

* **web:** drain response body so chromium reports requestfinished ([#62](https://github.com/vineethkrishnan/vaultctl/issues/62)) ([b2cf8ec](https://github.com/vineethkrishnan/vaultctl/commit/b2cf8ec9ade121b1d0f9b31fe81b106b1997ebec))

## [1.2.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.2.0...v1.2.1) (2026-05-09)


### Bug Fixes

* make first-time production deploy actually work ([#58](https://github.com/vineethkrishnan/vaultctl/issues/58)) ([5b0e0c8](https://github.com/vineethkrishnan/vaultctl/commit/5b0e0c8074e6941a35166a84349c409a78f8fccf))

## [1.2.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.6...v1.2.0) (2026-04-12)


### Features

* **api:** complete all architecture endpoints — 53 total ([#32](https://github.com/vineethkrishnan/vaultctl/issues/32)) ([0e3c25c](https://github.com/vineethkrishnan/vaultctl/commit/0e3c25c0c2d0d6fc7db18e336cf294d10f0d7e30))
* swagger UI, 48 API endpoints, orval codegen, security hardening ([#30](https://github.com/vineethkrishnan/vaultctl/issues/30)) ([c882a61](https://github.com/vineethkrishnan/vaultctl/commit/c882a615216c449a57213f7e970f93736bd46df2))


### Bug Fixes

* **web:** import dialog vault picker + unskip sessions e2e ([#33](https://github.com/vineethkrishnan/vaultctl/issues/33)) ([297a86a](https://github.com/vineethkrishnan/vaultctl/commit/297a86a9cad2882b3b071a8dbc7b8664cfa6347f))

## [1.1.6](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.5...v1.1.6) (2026-04-09)


### Bug Fixes

* **docker:** default to server cmd, latest tag, and docker hub registry ([4ce525b](https://github.com/vineethkrishnan/vaultctl/commit/4ce525bd7129b7df162f5882761df1485af5de2c))

## [1.1.5](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.4...v1.1.5) (2026-04-09)


### Documentation

* **docs:** add all installation methods ([#27](https://github.com/vineethkrishnan/vaultctl/issues/27)) ([c31ed02](https://github.com/vineethkrishnan/vaultctl/commit/c31ed02bab584b6cdf973e93ea46aca1b606908a))

## [1.1.4](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.3...v1.1.4) (2026-04-09)


### Bug Fixes

* **ci:** deploy docs to production branch on cloudflare pages ([#25](https://github.com/vineethkrishnan/vaultctl/issues/25)) ([f38e16e](https://github.com/vineethkrishnan/vaultctl/commit/f38e16ed6cbd54d576811e1cf1deed67dbf3e73c))

## [1.1.3](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.2...v1.1.3) (2026-04-09)


### Bug Fixes

* **ci:** pass cloudflare credentials as env vars for wrangler ([#23](https://github.com/vineethkrishnan/vaultctl/issues/23)) ([1de4da6](https://github.com/vineethkrishnan/vaultctl/commit/1de4da6d34bb2889caab0ad8800fa0237584ab93))

## [1.1.2](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.1...v1.1.2) (2026-04-09)


### Bug Fixes

* **ci:** move docs deploy to release workflow, match backupctl pattern ([#21](https://github.com/vineethkrishnan/vaultctl/issues/21)) ([913683d](https://github.com/vineethkrishnan/vaultctl/commit/913683d8dac5831c26a3b8b3c834b9a90f719bb8))

## [1.1.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.0...v1.1.1) (2026-04-09)


### Bug Fixes

* **ci:** skip SLSA attestation on private repos ([77e6e7a](https://github.com/vineethkrishnan/vaultctl/commit/77e6e7a21be132bbeb0c956ed2e3d68d8080c864))
* **docs:** repair cloudflare pages deployment for docs-site ([#20](https://github.com/vineethkrishnan/vaultctl/issues/20)) ([def6f41](https://github.com/vineethkrishnan/vaultctl/commit/def6f4110a5263ea39de25d15b57f79adba111b7))

## [1.1.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.0.1...v1.1.0) (2026-04-07)


### Features

* initial commit — backend M0-M14, docs-site, installer, CI/CD ([50c1d6a](https://github.com/vineethkrishnan/vaultctl/commit/50c1d6a9470f0342e6fdb58ac8c7e40572dc9e1f))


### Bug Fixes

* **ci:** allow 'main' scope for release-please PRs, tidy go.mod ([755fa03](https://github.com/vineethkrishnan/vaultctl/commit/755fa03e67f512be4154fca079d15c1e615e0a87))
* **ci:** bump go 1.25→1.26, fix golangci-lint action, exclude gosec G115/G204 ([cfa0dc3](https://github.com/vineethkrishnan/vaultctl/commit/cfa0dc371fda0d5c4f3ad27a6236e6d9b55ddfc6))
* **ci:** bump go 1.26.0→1.26.1 to resolve stdlib CVEs ([58777a0](https://github.com/vineethkrishnan/vaultctl/commit/58777a09cbcede010e6308c6a5392dab038665a7))
* **ci:** bump golangci-lint to v1.64, exclude gosec G107 ([5113ba1](https://github.com/vineethkrishnan/vaultctl/commit/5113ba1a69459025d6fcb768cc5dcadf719c2218))
* **ci:** correct Docker Hub username to vineethnkrishnan ([66f4086](https://github.com/vineethkrishnan/vaultctl/commit/66f4086797b2e4c739890605269c651e5add9ad6))
* **ci:** migrate golangci-lint config to v2 schema ([fd8fca6](https://github.com/vineethkrishnan/vaultctl/commit/fd8fca6b655f2e8071a1cea50b21642e978edd01))
* **ci:** resolve all golangci-lint v2 findings ([c99880f](https://github.com/vineethkrishnan/vaultctl/commit/c99880f3389814a7a21c763464d7ef1123d48ef2))
* **ci:** upgrade to golangci-lint v2 (v1.x can't parse go 1.26 deps) ([8afe23b](https://github.com/vineethkrishnan/vaultctl/commit/8afe23b3c875c6c52e69a5381315005b07c83481))
* **ci:** use explicit golangci-lint version v2.1 ([ee98a66](https://github.com/vineethkrishnan/vaultctl/commit/ee98a6652e030bb21781b8420c0203ad909ef6a5))
* **ci:** use go-version-file instead of hardcoded Go version ([a97ee0d](https://github.com/vineethkrishnan/vaultctl/commit/a97ee0d2ca3014d70c89d6ae1d863b2ec94b61d2))
* **ci:** use golangci-lint v2.11 (built with go 1.26) ([77b4f97](https://github.com/vineethkrishnan/vaultctl/commit/77b4f9778d4bf4cd28588b5f364d6a37a14ceaa7))
* **ci:** use minimal Dockerfile for goreleaser, fix Docker Hub description ([5e2339b](https://github.com/vineethkrishnan/vaultctl/commit/5e2339b005a1ae69572d443b88cbd322c3f89ae7))


### CI/CD

* **deps:** bump the actions group with 12 updates ([852c14a](https://github.com/vineethkrishnan/vaultctl/commit/852c14ac76738bfc2e87ece7a9b0dad2f189c9c1))
* **release:** add release-please, branch/tag protection, dependabot ([d012180](https://github.com/vineethkrishnan/vaultctl/commit/d0121805a4bc0ccdaa34259fc95614ba928231ac))

## [1.0.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.0.0...v1.0.1) (2026-04-07)


### Bug Fixes

* **ci:** use minimal Dockerfile for goreleaser, fix Docker Hub description ([5e2339b](https://github.com/vineethkrishnan/vaultctl/commit/5e2339b005a1ae69572d443b88cbd322c3f89ae7))

## 1.0.0 (2026-04-07)


### Features

* initial commit — backend M0-M14, docs-site, installer, CI/CD ([50c1d6a](https://github.com/vineethkrishnan/vaultctl/commit/50c1d6a9470f0342e6fdb58ac8c7e40572dc9e1f))


### Bug Fixes

* **ci:** allow 'main' scope for release-please PRs, tidy go.mod ([755fa03](https://github.com/vineethkrishnan/vaultctl/commit/755fa03e67f512be4154fca079d15c1e615e0a87))
* **ci:** bump go 1.25→1.26, fix golangci-lint action, exclude gosec G115/G204 ([cfa0dc3](https://github.com/vineethkrishnan/vaultctl/commit/cfa0dc371fda0d5c4f3ad27a6236e6d9b55ddfc6))
* **ci:** bump go 1.26.0→1.26.1 to resolve stdlib CVEs ([58777a0](https://github.com/vineethkrishnan/vaultctl/commit/58777a09cbcede010e6308c6a5392dab038665a7))
* **ci:** bump golangci-lint to v1.64, exclude gosec G107 ([5113ba1](https://github.com/vineethkrishnan/vaultctl/commit/5113ba1a69459025d6fcb768cc5dcadf719c2218))
* **ci:** migrate golangci-lint config to v2 schema ([fd8fca6](https://github.com/vineethkrishnan/vaultctl/commit/fd8fca6b655f2e8071a1cea50b21642e978edd01))
* **ci:** resolve all golangci-lint v2 findings ([c99880f](https://github.com/vineethkrishnan/vaultctl/commit/c99880f3389814a7a21c763464d7ef1123d48ef2))
* **ci:** upgrade to golangci-lint v2 (v1.x can't parse go 1.26 deps) ([8afe23b](https://github.com/vineethkrishnan/vaultctl/commit/8afe23b3c875c6c52e69a5381315005b07c83481))
* **ci:** use explicit golangci-lint version v2.1 ([ee98a66](https://github.com/vineethkrishnan/vaultctl/commit/ee98a6652e030bb21781b8420c0203ad909ef6a5))
* **ci:** use go-version-file instead of hardcoded Go version ([a97ee0d](https://github.com/vineethkrishnan/vaultctl/commit/a97ee0d2ca3014d70c89d6ae1d863b2ec94b61d2))
* **ci:** use golangci-lint v2.11 (built with go 1.26) ([77b4f97](https://github.com/vineethkrishnan/vaultctl/commit/77b4f9778d4bf4cd28588b5f364d6a37a14ceaa7))


### CI/CD

* **deps:** bump the actions group with 12 updates ([852c14a](https://github.com/vineethkrishnan/vaultctl/commit/852c14ac76738bfc2e87ece7a9b0dad2f189c9c1))
* **release:** add release-please, branch/tag protection, dependabot ([d012180](https://github.com/vineethkrishnan/vaultctl/commit/d0121805a4bc0ccdaa34259fc95614ba928231ac))
