#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
jss - JS 侦察流水线（面向 SRC / 授权测试，配合 Claude Code / ZCode 等 AI Agent 使用）

分层设计（工具做广度，AI 做深度）:
  收集层  collect  katana 主动爬取（硬限速 + 时长预算 + 单域页数上限，防风控）
  收集层  passive  waymore 被动收集（只查第三方存档，对目标站 0 请求）
  收集层  har      从浏览器 DevTools 导出的 HAR 中提取带登录态的 JS 响应体（对目标站 0 请求）
  收集层  ingest   导入抓包流量 JSON（Yakit MCP / 浏览器 MCP 提取的 flows），落盘 JS + 登录态 API 端点
  提取层  analyze  正则端点引擎 + hae 规则引擎（密钥/指纹）+ jsluice AST（可选槽）
                    输出 report/ai_brief.md 供 AI 做语义分析与优先级排序

用法示例:
  python jss.py collect https://target.com          # 主动收集 + 礼貌下载
  python jss.py passive target.com                  # 被动收集（waymore 历史响应体）
  python jss.py har site.har                        # 从 HAR 提取登录态 JS
  python jss.py analyze                             # 分析最近一次收集结果
  python jss.py analyze D:\\wxapp\\decompiled        # 分析本地目录（如反编译小程序）
  python jss.py all https://target.com              # collect + passive + analyze
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
import random
import re
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
# 可移植布局：工具可在 ROOT、ROOT/bin（打包布局）、ROOT/src（源码布局）
def _first_existing(*paths):
    for p in paths:
        if p.exists():
            return p
    return paths[0]

KATANA = _first_existing(ROOT / "katana" / "katana.exe", ROOT / "bin" / "katana.exe")
WAYMORE_DIR = _first_existing(ROOT / "waymore-8.9", ROOT / "src" / "waymore-8.9")
JSLUICE_CANDIDATES = [ROOT / "jsluice.exe", ROOT / "bin" / "jsluice.exe"]
# hae 联动：不改 hae，运行时按序探测本机已装的 hae skill（zcode/agents/claude 三处）
_HOME = Path(os.path.expanduser("~"))
HAE_CANDIDATES = ([Path(os.environ["JSS_HAE"])] if os.environ.get("JSS_HAE") else []) + [
    _HOME / ".zcode" / "skills" / "hae" / "scripts" / "hae_scan.py",
    _HOME / ".agents" / "skills" / "hae" / "scripts" / "hae_scan.py",
    _HOME / ".claude" / "skills" / "hae" / "scripts" / "hae_scan.py",
]
# 工作目录默认走会话目录（cwd/work/<目标名>），AI 能直接看到已有产物避免重复爬取
# 可用 JSS_WORK 环境变量重定位（skill 与工具分离部署时用）
WORK_ROOT = Path(os.environ["JSS_WORK"]).resolve() if os.environ.get("JSS_WORK") else Path.cwd() / "work"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
MAX_BYTES = 5 * 1024 * 1024
SLEEP_RANGE = (0.6, 1.5)  # 每次下载之间的随机间隔（秒）
# 本地目录分析时跳过的二进制/媒体扩展（反编译小程序产物里有大量图片字体）
SKIP_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg",
             ".woff", ".woff2", ".ttf", ".eot", ".otf", ".mp3", ".mp4", ".wav",
             ".avi", ".zip", ".gz", ".7z", ".apk", ".wasm", ".css", ".map.bin"}
# 小程序反编译产物特征文件
MINIPROGRAM_MARKERS = ("app-service.js", "__APP__.js", "app.json",
                       "app-config.json", "page-frame.js", "game.js")


def out(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# 环境处理
# ---------------------------------------------------------------------------

def env_sane(extra=None):
    """子进程环境：修复 Windows 注册表里挂着的死代理（ProxyBridge 未启动时）。
    只有当注册表代理确实连不通时才强制 NO_PROXY，活着的代理（用户主动开的）不受影响。"""
    env = dict(os.environ)
    if not (env.get("HTTP_PROXY") or env.get("HTTPS_PROXY")):
        proxies = {}
        try:
            from urllib.request import getproxies
            proxies = getproxies()
        except Exception:
            pass
        hp = proxies.get("https") or proxies.get("http")
        if hp and not _proxy_alive(hp):
            env["NO_PROXY"] = "*"
            env["no_proxy"] = "*"
    env["PYTHONIOENCODING"] = "utf-8"
    if extra:
        env.update(extra)
    return env


def _proxy_alive(hp):
    m = re.match(r"(?:https?://)?([^:/]+):(\d+)", hp)
    if not m:
        return False
    try:
        s = socket.create_connection((m.group(1), int(m.group(2))), timeout=1.5)
        s.close()
        return True
    except OSError:
        return False


def smart_opener():
    """下载用 opener：同样绕过死代理。"""
    env = env_sane()
    if env.get("NO_PROXY") == "*":
        return build_opener(ProxyHandler({}))
    return build_opener()


def find_hae(override=None):
    """hae_scan.py 探测：--hae 参数 > JSS_HAE 环境变量 > 三处 skill 目录。返回 None 表示降级。"""
    if override:
        p = Path(override)
        return p if p.exists() else None
    for p in HAE_CANDIDATES:
        if p.exists():
            return p
    return None


def find_jsluice(override=None):
    if override:
        p = Path(override)
        return p if p.exists() else None
    for p in JSLUICE_CANDIDATES:
        if p.exists():
            return p
    return None


def workdir(label):
    host = urlsplit(label if "//" in label else "//" + label).netloc or label
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", host).strip("_") or "target"
    d = WORK_ROOT / safe
    d.mkdir(parents=True, exist_ok=True)
    return d


def safe_name(name, limit=60):
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name or "file")
    return name[-limit:]


# ---------------------------------------------------------------------------
# 收集层 1：katana 主动爬取（限速 + 预算）
# ---------------------------------------------------------------------------

def cmd_collect(args):
    if not KATANA.exists():
        out("[!] 找不到 %s" % KATANA)
        return 1
    d = workdir(args.url)
    url_file = d / "urls_katana.txt"
    # 不用 -em js,map 过滤（带 query 参数时扩展名不匹配），改用 Python 端过滤
    cmd = [
        str(KATANA),
        "-u", args.url,
        "-d", str(args.depth),          # 爬取深度
        "-jc",                          # 解析 JS 里的端点继续爬
        "-kf", "all",                   # robots.txt / sitemap.xml
        "-fs", "rdn",                   # 锁定在注册域内，不跑到别人的站
        "-c", "4",                      # 并发 4（默认 10，压一半）
        "-rl", str(args.rate),          # 每秒请求上限（默认 2）
        "-hrl", "1",                    # 每主机每秒最多 1 个请求
        "-rd", "1",                     # 请求间隔 1 秒
        "-ct", args.budget,             # 总时长预算（默认 8m，到点即停）
        "-mdp", str(args.pages),        # 单域页面数上限
        "-timeout", "8", "-retry", "1",
        "-duc", "-nc", "-silent",
        "-o", str(url_file),
    ]
    out("[+] katana 主动收集：限速 %s req/s、每主机 1 req/s、时长预算 %s、单域上限 %s 页"
        % (args.rate, args.budget, args.pages))
    rc = subprocess.run(cmd, env=env_sane()).returncode
    if rc != 0:
        out("[!] katana 退出码 %s，继续处理已拿到的结果" % rc)
    if not url_file.exists():
        out("[-] 未产生 URL 列表（目标不可达或被拦截？）")
        return 1
    urls = [u for u in url_file.read_text(encoding="utf-8", errors="ignore").splitlines() if u.strip()]
    # Python 端过滤 JS/sourcemap URL（兼容带 query 参数的场景）
    js_urls = [u for u in urls if re.search(r'\.(js|map)(\?|$)', u, re.I)]
    out("[+] 收集到 %d 条 URL（其中 JS/map %d 条）-> %s" % (len(urls), len(js_urls), url_file))
    # 只保留 JS/map URL 供下载
    url_file.write_text("\n".join(js_urls), encoding="utf-8")
    if not args.no_download and js_urls:
        download_js(d, url_file, args.max_files)
    elif args.no_download:
        out("[i] --no-download，跳过下载")
    else:
        out("[i] 无 JS/map URL 可下载")
    out("[+] collect 完成，工作目录: %s" % d)
    if not args.no_download:
        out("[i] 下一步: python jss.py analyze")
    return 0


# ---------------------------------------------------------------------------
# 礼貌下载（串行 + 随机延迟 + 总量上限）
# ---------------------------------------------------------------------------

def download_js(d, url_file, max_files):
    jsdir = d / "js"
    jsdir.mkdir(exist_ok=True)
    manifest_path = d / "manifest.json"
    manifest = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}

    seen, queue = set(), []
    for u in url_file.read_text(encoding="utf-8", errors="ignore").splitlines():
        u = u.strip()
        if u.startswith("http") and u not in seen and u not in {v.get("url") for v in manifest.values()}:
            seen.add(u)
            queue.append(u)

    opener = smart_opener()
    ok = skip = fail = 0
    t0 = time.time()
    for u in queue:
        if ok >= max_files:
            out("[!] 达到下载上限 %d，停止（剩余 %d 条未下载）" % (max_files, len(queue) - ok - skip - fail))
            break
        time.sleep(random.uniform(*SLEEP_RANGE))
        try:
            req = Request(u, headers={"User-Agent": UA, "Accept": "*/*"})
            with opener.open(req, timeout=12) as resp:
                data = resp.read(MAX_BYTES + 1)
                status = getattr(resp, "status", 200)
            if len(data) > MAX_BYTES:
                skip += 1
                continue
            head = data[:512].lstrip().lower()
            if head.startswith(b"<!doctype") or head.startswith(b"<html"):
                skip += 1  # soft-404 / 返回了错误页
                continue
            name = hashlib.sha1(u.encode()).hexdigest()[:12] + "_" + safe_name(Path(urlsplit(u).path).name)
            (jsdir / name).write_bytes(data)
            manifest[name] = {"url": u, "status": status, "size": len(data)}
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 5:
                out("[-] 失败 %s (%s)" % (u, e))
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    out("[+] 下载完成：成功 %d / 跳过 %d / 失败 %d，耗时 %.0fs -> %s"
        % (ok, skip, fail, time.time() - t0, jsdir))
    return ok


# ---------------------------------------------------------------------------
# 收集层 2：waymore 被动收集（对目标 0 请求）
# ---------------------------------------------------------------------------

def _is_junk(p):
    """waymore 的断点续传/索引文件不是分析对象。"""
    n = p.name.lower()
    return n.endswith(".tmp") or n in ("index.txt", "waymore_index.txt")


def cmd_passive(args):
    if not WAYMORE_DIR.exists():
        out("[!] 找不到 %s" % WAYMORE_DIR)
        return 1
    domain = args.domain[4:] if args.domain.lower().startswith("www.") else args.domain
    # 兼容用户传入 URL 而非纯域名
    if "//" in domain:
        domain = urlsplit(domain).netloc or domain
    d = workdir(domain)
    rdir = d / "waymore_responses"
    rdir.mkdir(exist_ok=True)
    cmd = [
        sys.executable, "-m", "waymore.waymore",
        "-i", domain,
        "-mode", "R",                                   # 只下响应体（不打目标站）
        "-oR", str(rdir),
        "-ko", r"\.js(\?.*|$)",                         # 只收 .js（兼容 query 参数）
        "-mc", "200",                                   # 只收成功响应
        "-l", str(-args.limit),                         # 负数 = 最新 N 份
        "-lr", str(args.req_limit),                     # 每数据源请求上限
        "-t", "30", "-r", "1", "-ow",
    ]
    out("[+] waymore 被动收集：只查第三方存档（wayback/commoncrawl/otx/...），目标站 0 请求；"
        "最新 %d 份 JS 响应体" % args.limit)
    rc = subprocess.run(cmd, cwd=str(WAYMORE_DIR), env=env_sane()).returncode
    if rc != 0:
        out("[!] waymore 退出码 %s（存档在国内网络偶发超时属正常），查看已有结果" % rc)
    n = len([p for p in rdir.iterdir() if p.is_file() and not _is_junk(p)])
    out("[+] waymore 响应体落盘 %d 份 -> %s" % (n, rdir))
    return 0


# ---------------------------------------------------------------------------
# 收集层 3：HAR 提取（登录态，对目标 0 请求）
# ---------------------------------------------------------------------------

def cmd_har(args):
    har = Path(args.har)
    if not har.exists():
        out("[!] HAR 文件不存在: %s" % har)
        return 1
    data = json.loads(har.read_text(encoding="utf-8", errors="ignore"))
    entries = data.get("log", {}).get("entries", [])
    d = workdir("har_" + har.stem)
    jsdir = d / "js"
    jsdir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for e in entries:
        req = e.get("request", {})
        resp = e.get("response", {})
        url = req.get("url", "")
        if not url.startswith("http"):
            continue
        path = urlsplit(url).path.lower()
        mime = (resp.get("content", {}).get("mimeType") or "").lower()
        if not (path.endswith((".js", ".map")) or "javascript" in mime):
            continue
        content = resp.get("content", {})
        text = content.get("text")
        if not text:
            continue
        try:
            raw = base64.b64decode(text) if content.get("encoding") == "base64" else text.encode("utf-8")
        except Exception:
            continue
        name = hashlib.sha1(url.encode()).hexdigest()[:12] + "_" + safe_name(Path(urlsplit(url).path).name)
        (jsdir / name).write_bytes(raw)
        manifest[name] = {"url": url, "status": resp.get("status", 200),
                          "size": len(raw), "source": "har"}
    (d / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    out("[+] 从 HAR 提取 JS %d 份（带登录态，0 请求）-> %s" % (len(manifest), jsdir))
    out("[i] 下一步: python jss.py analyze --dir \"%s\"" % d)
    return 0


# ---------------------------------------------------------------------------
# 收集层 4：ingest 导入抓包流量 JSON（Yakit MCP / 浏览器 MCP）
# ---------------------------------------------------------------------------

def _maybe_unquote(s):
    """yakit MCP 返回的 request/response 字段可能是 JSON 二次编码的字符串。"""
    if isinstance(s, str) and s.startswith('"') and s.endswith('"'):
        try:
            return json.loads(s)
        except Exception:
            return s.strip('"')
    return s


def cmd_ingest(args):
    """输入 JSON（flow 数组或 {"flows": [...]}），每条字段：
    url / method / status_code / request / response（原始 HTTP 报文），
    或直接给 body / body_b64。
    JS 响应体 + API JSON/HTML 响应体全部落盘，所有请求路径进 flows_endpoints.txt。"""
    src = Path(args.flows)
    if not src.exists():
        out("[!] 流量文件不存在: %s" % src)
        return 1
    try:
        data = json.loads(src.read_text(encoding="utf-8", errors="ignore"))
    except Exception as e:
        out("[!] JSON 解析失败: %s" % e)
        return 1
    flows = data if isinstance(data, list) else data.get("flows") or []
    if not flows:
        out("[!] 流量文件里没有 flows 数组")
        return 1
    d = WORK_ROOT / (args.name or ("ingested_" + time.strftime("%Y%m%d_%H%M%S")))
    jsdir = d / "js"
    jsdir.mkdir(parents=True, exist_ok=True)
    manifest_path = d / "manifest.json"
    manifest = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}
    eps = {}
    n_js = n_api = n_resp = 0
    seen_urls = {v.get("url") for v in manifest.values()}
    for f in flows:
        if not isinstance(f, dict):
            continue
        url = (f.get("url") or "").strip()
        if not url.startswith("http"):
            continue
        req = _maybe_unquote(f.get("request") or "")
        resp = _maybe_unquote(f.get("response") or "")
        method = (f.get("method") or "").strip()
        if not method and req:
            method = req.split(" ", 1)[0].strip('"')
        status = str(f.get("status_code") or "").strip() or "-"
        p = urlsplit(url)
        ep = p.path + (("?" + p.query) if p.query else "")
        if ep and ep not in eps:
            eps[ep] = (method or "-", status)
            n_api += 1
        # 提取响应体并落盘（所有类型，不仅是 JS）
        body = None
        if f.get("body_b64"):
            try:
                body = base64.b64decode(f["body_b64"])
            except Exception:
                body = None
        elif f.get("body") is not None:
            body = str(f["body"]).encode("utf-8")
        if body is None and "\r\n\r\n" in resp:
            body = resp.split("\r\n\r\n", 1)[1].encode("utf-8", errors="replace")
        if not body:
            continue
        # 判断是否为 JS 响应
        head = resp.split("\r\n\r\n", 1)[0]
        mtype = ""
        m = re.search(r"(?im)^content-type:\s*([^\r\n]+)", head)
        if m:
            mtype = m.group(1).lower().split(";")[0].strip()
        plow = p.path.lower()
        is_js = plow.endswith((".js", ".map")) or "javascript" in mtype
        # 跳过已落盘的 URL
        if url in seen_urls:
            continue
        seen_urls.add(url)
        # 从 Content-Type 推断扩展名，方便识别文件类型
        _CT_EXT = {"application/json": ".json", "text/html": ".html",
                   "text/xml": ".xml", "application/xml": ".xml",
                   "text/plain": ".txt", "text/css": ".css"}
        ext = _CT_EXT.get(mtype, "")
        base_name = safe_name(Path(p.path).name or "response", 48)
        name = hashlib.sha1(url.encode()).hexdigest()[:12] + "_" + base_name
        if ext and not name.endswith(ext):
            name += ext
        (jsdir / name).write_bytes(body)
        manifest[name] = {"url": url, "status": status, "size": len(body),
                          "source": "ingest_js" if is_js else "ingest_api"}
        n_resp += 1
        if is_js:
            n_js += 1
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    (d / "flows_endpoints.txt").write_text(
        "\n".join("%s %s %s" % (m_, s_, e) for e, (m_, s_) in sorted(eps.items())),
        encoding="utf-8")
    out("[+] ingest 完成：%d 份 JS 落盘、%d 份 API 响应体落盘、%d 个登录态 API 端点 -> %s"
        % (n_js, n_resp - n_js, n_api, d))
    out("[i] 下一步: python jss.py analyze")
    return 0


# ---------------------------------------------------------------------------
# 提取层：端点正则引擎 + hae + jsluice（可选）+ AI 简报
# ---------------------------------------------------------------------------

QUOTED_URL = re.compile(r"""["'`]((?:https?:)?//[^"'`\s<>]{4,300})["'`]""")
QUOTED_PATH = re.compile(r"""["'`](/(?:[^"'`\s<>{}]{2,200}))["'`]""")
SKIP_SCHEME = ("data:", "blob:", "javascript:", "mailto:", "chrome-extension:",
               "webpack-internal:", "ws:", "wss:", "android-app:", "itms-")
SKIP_EXT = (".png", ".jpg", ".jpeg", ".gif", ".css", ".woff", ".woff2", ".svg",
            ".ico", ".mp4", ".mp3", ".ttf", ".eot", ".webp", ".otf")
GROUPS = [
    ("admin-管理后台", re.compile(r"admin|manage|console|backend|dashboard|sysuser|root", re.I)),
    ("internal-内部调试", re.compile(r"internal|debug|swagger|actuator|druid|phpinfo|stag|dev\b|mock|backup|\.bak|config", re.I)),
    ("auth-认证敏感", re.compile(r"login|auth|token|sso|oauth|captcha|verify|password|passwd|secret|/key|apikey|api_key|sign|encrypt|decrypt|aes|rsa|private", re.I)),
    ("upload-export-上传导出", re.compile(r"upload|export|download|import|attach|file/", re.I)),
    ("api-接口", re.compile(r"/api/|/v\d+/|graphql|/rest/|/rpc/|/gateway|/service/|/srv/|\.json|\.do|\.action", re.I)),
]
SOURCEMAP_RE = re.compile(r"//[#@]\s*sourceMappingURL=([^\s'\"<>]+)")


def classify(ep):
    for name, rx in GROUPS:
        if rx.search(ep):
            return name
    return "other-其他"


def extract_endpoints(files):
    """返回 [(endpoint, source_file, line)]，已按 endpoint 去重（保留首个位置）。"""
    found = {}
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for rx in (QUOTED_URL, QUOTED_PATH):
            for m in rx.finditer(text):
                ep = m.group(1).strip()
                low = ep.lower()
                if any(low.startswith(s) for s in SKIP_SCHEME):
                    continue
                if low.endswith(SKIP_EXT) and not low.endswith(".map"):
                    continue
                if len(ep) < 5 or "\\" in ep:
                    continue
                line = text.count("\n", 0, m.start()) + 1
                if ep not in found:
                    found[ep] = (str(f), line)
    return [(ep, loc[0], loc[1]) for ep, loc in found.items()]


def run_jsluice(binary, files):
    """可选 AST 引擎。jsluice 以文件路径为参数，逐行输出 JSON。"""
    results = []
    batch = [str(f) for f in files]
    for i in range(0, len(batch), 50):
        chunk = batch[i:i + 50]
        try:
            p = subprocess.run([str(binary), "urls"] + chunk,
                               capture_output=True, timeout=120, env=env_sane())
        except Exception:
            continue
        for line in p.stdout.decode("utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                j = json.loads(line)
            except Exception:
                continue
            u = j.get("url") or j.get("path")
            if u:
                results.append((u, j.get("filename") or "", 0, j.get("queryParams") or []))
    return results


def run_hae(hae_path, targets, report_dir):
    hae_json = report_dir / "hae.json"
    cmd = [sys.executable, str(hae_path)] + [str(t) for t in targets] + ["-o", str(hae_json)]
    try:
        subprocess.run(cmd, capture_output=True, timeout=900, env=env_sane())
    except Exception as e:
        out("[!] hae 扫描失败: %s" % e)
        return None
    if not hae_json.exists():
        return None
    try:
        return json.loads(hae_json.read_text(encoding="utf-8"))
    except Exception:
        return None


def hae_highlights(hae_data, top=25):
    """从 hae JSON 里挑 AI 该看的高价值命中。"""
    picks = {"Sensitive Information": [], "Fingerprint": [], "Maybe Vulnerability": []}
    if not hae_data:
        return picks
    for f in hae_data.get("findings", []):
        g = f.get("group")
        if g not in picks:
            continue
        loc = (f.get("locations") or [{}])[0]
        picks[g].append({
            "rule": f.get("rule"), "match": (f.get("match") or "")[:200],
            "file": loc.get("file"), "line": loc.get("line"), "count": f.get("count", 1),
        })
    for g in picks:
        picks[g] = sorted(picks[g], key=lambda x: -(x.get("count") or 1))[:top]
    return picks


def latest_workdir():
    base = WORK_ROOT
    if not base.exists():
        return None
    cands = [p for p in base.iterdir() if p.is_dir()]
    if not cands:
        return None
    return max(cands, key=lambda p: p.stat().st_mtime)


def cmd_analyze(args):
    # 确定分析对象：--dir（可多个，支持小程序反编译目录）或最近一次 work 目录
    if args.dir:
        targets = [Path(x).resolve() for x in args.dir]
        label = "_local_" + safe_name(targets[0].name, 30)
        d = WORK_ROOT / label
    else:
        d = latest_workdir()
        if d is None:
            out("[!] 没有 --dir，且 %s 下没有历史结果。先跑 collect/passive/har/ingest，或直接指定目录" % WORK_ROOT)
            return 1
        targets = [p for p in (d / "js", d / "waymore_responses") if p.exists()]
        if not targets:
            out("[!] %s 下没有 js/ 或 waymore_responses/，请先收集或用 --dir 指定" % d)
            return 1

    report = d / "report"
    report.mkdir(parents=True, exist_ok=True)
    files = []
    for t in targets:
        files.extend(p for p in t.rglob("*")
                     if p.is_file() and not _is_junk(p)
                     and p.suffix.lower() not in SKIP_EXTS
                     and p.stat().st_size <= 8 * 1024 * 1024)
    if not files:
        out("[!] 目标目录里没有可分析文件")
        return 1
    out("[+] 分析 %d 个文件（来自 %s）" % (len(files), ", ".join(str(t) for t in targets)))

    # 本地反编译小程序识别（无法爬取的场景，analyze 是唯一入口）
    is_mini = any(f.name.lower() in MINIPROGRAM_MARKERS for f in files)
    appid = ""
    if is_mini:
        for f in files:
            if f.name.lower() in ("app.json", "app-config.json", "project.config.json"):
                try:
                    m = re.search(r'"appid"\s*:\s*"([^"]+)"',
                                  f.read_text(encoding="utf-8", errors="ignore"))
                    if m:
                        appid = m.group(1)
                        break
                except Exception:
                    pass

    # 登录态抓包带来的 API 端点（ingest 写入 flows_endpoints.txt）
    captured = []
    flows_file = d / "flows_endpoints.txt"
    if flows_file.exists():
        for line in flows_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            parts = line.split(" ", 2)
            if len(parts) == 3:
                captured.append((parts[0], parts[1], parts[2]))

    # 1) 正则端点引擎（jsluice 缺席时的主力，始终运行）
    eps = extract_endpoints(files)
    # 2) jsluice 可选 AST 引擎
    jsl = find_jsluice(args.jsluice)
    jsl_eps = []
    jsl_note = "未安装（AST 引擎未启用，正则引擎已覆盖主场景）"
    if jsl and jsl.exists():
        jsl_eps = run_jsluice(jsl, files)
        jsl_deduped = len({e[0] for e in jsl_eps}) if jsl_eps else 0
        if jsl_eps:
            jsl_note = "已启用（%d 条原始/%d 条去重，含拼接参数场景）" % (len(jsl_eps), jsl_deduped)
        else:
            jsl_note = "已找到二进制但未产出结果，请自行验证版本"

    all_eps = {e[0]: e for e in eps}
    for e in jsl_eps:
        all_eps.setdefault(e[0], e)

    grouped = {}
    for ep in sorted(all_eps):
        grouped.setdefault(classify(ep), []).append(all_eps[ep])

    # 3) sourcemap 引用
    sourcemaps = []
    for f in files:
        try:
            m = SOURCEMAP_RE.search(f.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            m = None
        if m:
            sourcemaps.append((m.group(1), str(f)))

    # 4) hae 规则引擎（联动本地 hae skill，不修改 hae 本身）
    hae_path = find_hae(args.hae)
    hae_data = None
    if hae_path:
        out("[+] hae 规则扫描（密钥/指纹/敏感信息）<- %s" % hae_path)
        hae_data = run_hae(hae_path, targets, report)
    else:
        out("[i] 未探测到本地 hae skill（JSS_HAE / ~/.zcode|.agents|.claude/skills/hae），"
            "规则引擎降级；需要时 analyze --hae <hae_scan.py路径> 显式指定")
    hl = hae_highlights(hae_data)

    # 5) 落盘
    (report / "endpoints.txt").write_text(
        "\n".join(sorted(all_eps)), encoding="utf-8")
    (report / "endpoints.json").write_text(
        json.dumps({g: [{"endpoint": e[0], "file": e[1], "line": e[2]} for e in items]
                    for g, items in grouped.items()}, ensure_ascii=False, indent=1),
        encoding="utf-8")

    brief = []
    brief.append("# AI 分析简报（%s）\n" % d.name)
    brief.append("> 规则命中是线索不是结论。逐条判断利用价值后，再回到源文件核实。\n")
    brief.append("## 概览\n")
    brief.append("| 指标 | 值 |")
    brief.append("|---|---|")
    if is_mini:
        brief.append("| 场景 | 微信小程序反编译产物%s（本地文件，无爬取路径，analyze 即全流程）|"
                     % ("，appid=%s" % appid if appid else ""))
    brief.append("| 文件数 | %d |" % len(files))
    brief.append("| 唯一端点 | %d（正则 %d + jsluice %d）|" % (len(all_eps), len(eps), len(jsl_eps)))
    brief.append("| jsluice | %s |" % jsl_note)
    brief.append("| sourcemap 引用 | %d |" % len(sourcemaps))
    brief.append("| 已捕获API端点(登录态) | %d |" % len(captured))
    hae_total = hae_data.get("summary", {}).get("unique_matches", 0) if hae_data else 0
    brief.append("| hae 命中(去重) | %s |\n" % hae_total)

    order = [g for g, _ in GROUPS] + ["other-其他"]
    brief.append("## 端点（按优先级分组）\n")
    for g in order:
        items = grouped.get(g, [])
        if not items:
            continue
        brief.append("### %s（%d）\n" % (g, len(items)))
        for e in items[:20]:
            brief.append("- `%s`  @ %s:%s" % (e[0], Path(e[1]).name, e[2]))
        if len(items) > 20:
            brief.append("- ...共 %d 条，完整清单见 endpoints.txt" % len(items))
        brief.append("")

    if captured:
        brief.append("## 已捕获 API 端点（登录态流量，来自 Yakit/抓包回放）\n")
        brief.append("> 这些端点在真实登录会话中被调用过，可直接配 cookie 重放验证。\n")
        for m_, s_, p_ in captured[:30]:
            brief.append("- `%s %s` %s" % (m_, s_, p_))
        if len(captured) > 30:
            brief.append("- ...共 %d 条，完整清单见 flows_endpoints.txt" % len(captured))
        brief.append("")

    if sourcemaps:
        brief.append("## SourceMap（可能还原原始源码，高价值）\n")
        for u, f in sourcemaps[:15]:
            brief.append("- `%s`  @ %s" % (u, Path(f).name))
        brief.append("")

    for g, title in (("Sensitive Information", "敏感信息（密钥/凭据，逐条核实真实性）"),
                     ("Fingerprint", "框架指纹（判断技术栈，指导后续测试）"),
                     ("Maybe Vulnerability", "疑似弱点线索（需人工确认）")):
        if hl[g]:
            brief.append("## hae: %s\n" % title)
            for h in hl[g]:
                brief.append("- **%s** — `%s` @ %s:%s (x%s)"
                             % (h["rule"], h["match"], Path(h["file"] or "?").name, h["line"], h["count"]))
            brief.append("")

    brief.append("## AI 下一步动作\n")
    brief.append("1. 敏感信息逐条回源文件核实（排除占位符/测试数据），判断属于哪套签名/加密体系、能伪造什么。")
    brief.append("2. admin/internal 组端点逐个验证可达性与鉴权（401/403 记录，能匿名访问的重点标记）。")
    brief.append("3. sourcemap 引用若可下载，还原原始源码后重跑 `python jss.py analyze --dir <还原目录>`。")
    brief.append("4. 输出报告时引用 file:line，端点给完整清单文件路径。")
    brief_path = report / "ai_brief.md"
    brief_path.write_text("\n".join(brief), encoding="utf-8")
    out("[+] 简报 -> %s" % brief_path)
    out("[+] 完整端点 -> %s" % (report / "endpoints.txt"))
    return 0


# ---------------------------------------------------------------------------
# all：collect + passive + analyze
# ---------------------------------------------------------------------------

def cmd_all(args):
    """collect + passive + analyze。任何环节失败都继续走完，最后汇总跳过项。"""
    skipped = []
    if cmd_collect(args) != 0:
        skipped.append("collect(主动收集异常)")
    # 从 URL 中提取 hostname 传给 passive（兼容 http://host/path 格式）
    host = urlsplit(args.url if "//" in args.url else "//" + args.url).netloc or args.url
    pargs = argparse.Namespace(domain=host, limit=args.wm_limit, req_limit=args.wm_req_limit)
    if cmd_passive(pargs) != 0:
        skipped.append("passive(waymore 异常)")
    aargs = argparse.Namespace(dir=None, jsluice=args.jsluice, hae=args.hae)
    rc = cmd_analyze(aargs)
    if skipped:
        out("[i] 已跳过/降级的环节: %s" % "；".join(skipped))
    return rc


def cmd_list(_args):
    """列出 work/ 下所有历史目标，供 AI 定位'上次的结果'。"""
    base = WORK_ROOT
    if not base.exists():
        out("(没有历史结果)")
        return 0
    rows = []
    for p in sorted(base.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if not p.is_dir():
            continue
        n_js = len(list((p / "js").glob("*"))) if (p / "js").exists() else 0
        n_wm = len([p for p in (p / "waymore_responses").iterdir()
                    if p.is_file() and not _is_junk(p)]) if (p / "waymore_responses").exists() else 0
        flows = p / "flows_endpoints.txt"
        n_flow = len(flows.read_text(encoding="utf-8", errors="ignore").splitlines()) if flows.exists() else 0
        has_report = "有简报" if (p / "report" / "ai_brief.md").exists() else "-"
        ts = datetime.datetime.fromtimestamp(p.stat().st_mtime).strftime("%m-%d %H:%M")
        rows.append("%-30s %s  js=%-4d waymore=%-4d 登录态API=%-4d %s" % (p.name, ts, n_js, n_wm, n_flow, has_report))
    out("\n".join(rows) if rows else "(没有历史结果)")
    return 0


def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="jss - JS 侦察流水线（katana+waymore+har -> 提取 -> AI 简报）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("collect", help="katana 主动收集（限速+预算防风控）并礼貌下载 JS")
    p.add_argument("url")
    p.add_argument("--budget", default="8m", help="katana 总时长预算，如 5m/10m（默认 8m）")
    p.add_argument("--rate", type=int, default=2, help="每秒请求上限（默认 2）")
    p.add_argument("--pages", type=int, default=150, help="单域页面数上限（默认 150）")
    p.add_argument("--depth", type=int, default=3, help="爬取深度（默认 3）")
    p.add_argument("--max-files", type=int, default=300, help="下载落盘上限（默认 300）")
    p.add_argument("--no-download", action="store_true", help="只收 URL 不下载")
    p.set_defaults(func=cmd_collect)

    p = sub.add_parser("passive", help="waymore 被动收集（只查第三方存档，目标 0 请求）")
    p.add_argument("domain")
    p.add_argument("--limit", type=int, default=100, help="最新 N 份 JS 响应体（默认 100）")
    p.add_argument("--req-limit", type=int, default=1200, help="每数据源请求上限（默认 1200）")
    p.set_defaults(func=cmd_passive)

    p = sub.add_parser("har", help="从 DevTools 导出的 HAR 提取带登录态 JS（目标 0 请求）")
    p.add_argument("har")
    p.set_defaults(func=cmd_har)

    p = sub.add_parser("ingest", help="导入抓包流量 JSON（Yakit MCP / 浏览器 MCP 提取的 flows）")
    p.add_argument("flows", help="JSON 文件：flow 数组，字段 url/method/status_code/request/response 或 body/body_b64")
    p.add_argument("--name", default=None, help="目标名（work/ 下目录名，默认自动生成）")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("analyze", help="提取端点+密钥并生成 AI 简报（默认分析最近一次结果）")
    p.add_argument("dir", nargs="*", help="本地目录（支持反编译小程序目录），可多个")
    p.add_argument("--jsluice", default=None, help="jsluice 二进制路径（可选 AST 引擎）")
    p.add_argument("--hae", default=None, help="hae_scan.py 路径（默认用内置位置）")
    p.set_defaults(func=lambda a: cmd_analyze(
        argparse.Namespace(dir=a.dir or None, jsluice=a.jsluice, hae=a.hae)))

    p = sub.add_parser("list", help="列出所有历史目标结果（定位'上次分析的结果'，默认在会话目录 work/ 下）")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("all", help="collect + passive + analyze 一条龙（失败环节自动跳过并汇总）")
    p.add_argument("url")
    p.add_argument("--budget", default="8m")
    p.add_argument("--rate", type=int, default=2)
    p.add_argument("--pages", type=int, default=150)
    p.add_argument("--depth", type=int, default=3)
    p.add_argument("--max-files", type=int, default=300)
    p.add_argument("--no-download", action="store_true")
    p.add_argument("--wm-limit", type=int, default=100)
    p.add_argument("--wm-req-limit", type=int, default=1200)
    p.add_argument("--jsluice", default=None)
    p.add_argument("--hae", default=None)
    p.set_defaults(func=cmd_all)

    args = ap.parse_args()
    sys.exit(args.func(args) or 0)


if __name__ == "__main__":
    main()
