# Upstream baseline

Verified 2026-10-02, source HEAD `181ca58acc93238dc1b9192f04b33d4fa561a5af`, full 28-commit clone. No changes since audited commit. Node v24.18.0, npm 11.16.0, Git 2.55.0.windows.2. Upstream has a committed npm lockfile but no test script.

| Command | Actual result |
| --- | --- |
| npm install | Initial attempt failed EPERM because sandbox cannot write default npm cache. Repeated with a workspace cache: exit 0, 552 packages added, 3 changed, 556 audited. npm reported 30 advisories (4 low, 7 moderate, 19 high). |
| npm run build | Exit 0. TypeScript and Vite 6.2.0 successful, 54 modules. PWA 0.21.1 generated sw.js and Workbox, 7 precache entries. Browserslist warned outdated data. |
| npm run lint | Exit 1. 6 unused catch-variable errors in Database (4) and Words (2); 4 warnings (Learn hook dependencies 2, context Fast Refresh exports 2). |
| tests | No upstream test script or test files. |

The baseline failures are preserved here; checks will be repaired by replacing the responsible workflows and adding focused tests, not by disabling rules. Dependency advisories will be inspected before release. Machine-specific proxy/cache settings are execution-only and are not application requirements.
