# Third-Party Notices

VulnHunter bundles or relies on third-party components:

| Component | Location | License | Notes |
|---|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | host platform (not bundled) | MIT | VulnHunter is a plugin suite on top of it |
| [waymore](https://github.com/xnl-h4ck3r/waymore) | `vulnhunter/skills/vh-jss/waymore-8.9/` (vendored) | GPL-3.0 | Vendored unmodified for the passive-archive step. The GPL applies to that directory; the surrounding MIT code does not cover it. |
| katana / jsluice | `vulnhunter/skills/vh-jss/bin/` (**not bundled** — download separately) | see upstream | Not redistributed; fetch from their official releases. |
| enscan / amass / gogo / httpx | external binaries (not bundled) | see upstream | Recon CLIs; download from their official releases. |
