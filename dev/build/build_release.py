from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import importlib
import json
import mimetypes
import os
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from dataclasses import dataclass
from pathlib import Path


# ============================================================================
# Required minifiers
# ============================================================================

try:
    cssmin = importlib.import_module("rcssmin").cssmin
except ImportError as exc:
    raise RuntimeError(
        "rcssmin is required.\n"
        "Install with:\n"
        "    python -m pip install rcssmin rjsmin"
    ) from exc

try:
    jsmin = importlib.import_module("rjsmin").jsmin
except ImportError as exc:
    raise RuntimeError(
        "rjsmin is required.\n"
        "Install with:\n"
        "    python -m pip install rcssmin rjsmin"
    ) from exc


# ============================================================================
# Paths
# ============================================================================

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent.parent

DEV_DIR = ROOT_DIR / "dev"
CSS_DIR = DEV_DIR / "css"
JS_DIR = DEV_DIR / "javascript"
SVG_DIR = DEV_DIR / "svgs"
SPECIFICATION_DIR = DEV_DIR / "specification"
PACKAGES_DIR = DEV_DIR / "packages"
CACHE_DIR = PACKAGES_DIR / "cache"

MANIFEST_PATH = PACKAGES_DIR / "manifest.csv"
TEMPLATE_PATH = DEV_DIR / "index.html"
SVG_SOURCE = DEV_DIR / Path('svgs', 'Guerrilla-Ops.svg')
QA_SCHEMA_SOURCE = SPECIFICATION_DIR / "guerrilla-ops-schema.xml"

RELEASE_DIR = ROOT_DIR / "release"
RELEASE_LOCAL_PATH = RELEASE_DIR / "Guerrilla-Ops.html"
RELEASE_AIRGAPPED_PATH = RELEASE_DIR / "Guerrilla-Ops-Airgapped.html"
ROOT_OUTPUT_PATH = ROOT_DIR / "index.html"


# ============================================================================
# Configuration
# ============================================================================

USER_AGENT = "Guerrilla-Ops-Build/3.0"
DOWNLOAD_TIMEOUT = 60

EMBED_SCHEMA_PATTERN = re.compile(
    r"const\s+_COBIE_EMBEDDED_SCHEMA\s*=\s*(['\"]).*?\1\s*;",
    flags=re.DOTALL,
)
SCHEMA_PATHS_PATTERN = re.compile(
    r"const\s+_COBIE_SCHEMA_PATHS\s*=\s*Object\.freeze\(\s*\[[^\]]*\]\s*\)\s*;",
    flags=re.DOTALL,
)
SCHEMA_XMLTEXT_PATTERN = re.compile(
    r"const\s+xmlText\s*=\s*_COBIE_EMBEDDED_SCHEMA\s*\|\|\s*_cobieReadXmlSync\(_COBIE_SCHEMA_PATHS\)\s*;"
)

STYLESHEET_TAG_PATTERN = re.compile(
    r"<link\b[^>]*\brel\s*=\s*['\"]stylesheet['\"][^>]*>",
    flags=re.IGNORECASE,
)
SCRIPT_SRC_TAG_PATTERN = re.compile(
    r"<script\b[^>]*\bsrc\s*=\s*['\"][^'\"]+['\"][^>]*>\s*</script>",
    flags=re.IGNORECASE,
)
HREF_ATTR_PATTERN = re.compile(r"\bhref\s*=\s*['\"]([^'\"]+)['\"]", flags=re.IGNORECASE)
SRC_ATTR_PATTERN = re.compile(r"\bsrc\s*=\s*['\"]([^'\"]+)['\"]", flags=re.IGNORECASE)
CSS_URL_PATTERN = re.compile(
    r"url\(\s*(?:'([^']*)'|\"([^\"]*)\"|([^'\"\)]*))\s*\)",
    flags=re.IGNORECASE,
)
HTML_COMMENT_PATTERN = re.compile(r"<!--([\s\S]*?)-->")
XLSX_BRIDGE_PATTERN = re.compile(
    r"<script>\s*globalThis\.XLSX_STYLE\s*=\s*globalThis\.XLSX;\s*globalThis\.XLSX\s*=\s*globalThis\.XLSX_CORE;\s*</script>",
    flags=re.IGNORECASE,
)


# ============================================================================
# Models
# ============================================================================

@dataclass(frozen=True)
class ManifestAsset:
    url: str
    filename: str
    asset_type: str
    sha256: str


# ============================================================================
# Utilities
# ============================================================================


def fail(message: str) -> None:
    raise RuntimeError(message)


def validate_file(path: Path) -> None:
    if not path.is_file():
        fail(f"Missing file: {path}")
    if path.stat().st_size == 0:
        fail(f"Empty file: {path}")


def validate_xml(path: Path) -> None:
    try:
        ET.parse(path)
    except ET.ParseError as exc:
        fail(f"Invalid XML in {path}: {exc}")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_text_exact(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as fh:
        return fh.read()


def write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )

    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())

        os.replace(temp_path, path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def write_bytes_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )

    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())

        os.replace(temp_path, path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_filename(filename: str) -> str:
    filename = filename.strip()
    filename = re.sub(r"[^A-Za-z0-9._-]+", "_", filename)
    return filename or "asset"


def normalise_url(url: str) -> str:
    value = url.strip()
    if value.startswith("//"):
        value = "https:" + value

    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme.lower() in ("http", "https"):
        return urllib.parse.urlunsplit(
            (
                parsed.scheme.lower(),
                parsed.netloc.lower(),
                parsed.path,
                parsed.query,
                "",
            )
        )

    return value


def is_external_url(url: str) -> bool:
    value = url.strip().lower()
    return value.startswith(("http://", "https://", "//"))


def guess_asset_type(url_or_path: str) -> str:
    parsed = urllib.parse.urlsplit(url_or_path)
    path = parsed.path.lower()

    if path.endswith(".css"):
        return "css"
    if path.endswith(".js") or path.endswith(".mjs"):
        return "js"

    return ""


def js_string_literal(text: str) -> str:
    # Prevent </script> from terminating inline script blocks in built HTML.
    return json.dumps(text, ensure_ascii=False).replace("</", "<\\/")


def guess_mime_type(path_or_url: str) -> str:
    parsed = urllib.parse.urlsplit(path_or_url)
    extension = Path(parsed.path).suffix.lower()

    known = {
        ".css": "text/css",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".otf": "font/otf",
    }

    return known.get(
        extension,
        mimetypes.guess_type(path_or_url)[0] or "application/octet-stream",
    )


def data_uri(data: bytes, mime_type: str) -> str:
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


# ============================================================================
# Manifest parsing and cache management
# ============================================================================


def parse_manifest(manifest_path: Path) -> dict[str, ManifestAsset]:
    validate_file(manifest_path)

    items: dict[str, ManifestAsset] = {}

    with manifest_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        for row in reader:
            if not row:
                continue

            cells = [c.strip() for c in row]
            if not cells or not cells[0]:
                continue

            first = cells[0]
            if first.startswith("#") or first.lower() == "url":
                continue

            url = normalise_url(first)
            if not is_external_url(url):
                continue

            filename = ""
            asset_type = ""
            sha256 = ""

            if len(cells) >= 2:
                second = cells[1]
                if second and second.lower() not in ("js", "css"):
                    filename = second
                elif second.lower() in ("js", "css"):
                    asset_type = second.lower()

            if len(cells) >= 3:
                third = cells[2].lower()
                if third in ("js", "css"):
                    asset_type = third
                elif not filename:
                    filename = cells[2]

            if len(cells) >= 4:
                sha256 = cells[3].lower()
                if not re.fullmatch(r"[0-9a-f]{64}", sha256):
                    fail(f"Invalid SHA-256 digest in manifest row for URL:\n  {url}")

            if not filename:
                filename = safe_filename(Path(urllib.parse.urlsplit(url).path).name)

            if not asset_type:
                asset_type = guess_asset_type(filename) or guess_asset_type(url)

            if asset_type not in ("js", "css"):
                fail(
                    "Unsupported or missing asset type in manifest row for URL:\n"
                    f"  {url}"
                )

            items[url] = ManifestAsset(
                url=url,
                filename=safe_filename(filename),
                asset_type=asset_type,
                sha256=sha256,
            )

    if not items:
        fail(f"No valid manifest assets found in: {manifest_path}")

    return items


def download_bytes(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT) as response:
            data = response.read()
    except urllib.error.HTTPError as exc:
        fail(f"HTTP {exc.code} downloading:\n  {url}")
    except urllib.error.URLError as exc:
        fail(f"Unable to download:\n  {url}\n  {exc.reason}")

    if not data:
        fail(f"Downloaded empty response:\n  {url}")

    return data


def cache_path_for_manifest(asset: ManifestAsset) -> Path:
    return CACHE_DIR / asset.filename


def validate_asset_digest(asset: ManifestAsset, data: bytes) -> None:
    if asset.sha256 and sha256_bytes(data) != asset.sha256:
        fail(
            "SHA-256 mismatch for manifest asset:\n"
            f"  {asset.url}\n"
            f"  expected: {asset.sha256}\n"
            f"  actual:   {sha256_bytes(data)}"
        )


def get_manifest_asset_bytes(
    asset: ManifestAsset,
    refresh: bool,
    offline: bool,
) -> bytes:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = cache_path_for_manifest(asset)

    if path.is_file() and path.stat().st_size > 0 and not refresh:
        data = path.read_bytes()
        validate_asset_digest(asset, data)
        print(f"  CACHE  {asset.url} -> {path.name}")
        return data

    if offline:
        fail(
            "Offline mode is enabled and the required cache file is missing:\n"
            f"  {path}"
        )

    print(f"  FETCH  {asset.url}")
    data = download_bytes(asset.url)
    validate_asset_digest(asset, data)
    write_bytes_atomic(path, data)

    digest = sha256_bytes(data)[:12]
    print(f"  SAVED  {path.name} ({len(data) / 1024:.1f} KB, {digest})")
    return data


def ensure_manifest_cache(
    manifest_items: dict[str, ManifestAsset],
    refresh: bool,
    offline: bool,
) -> None:
    print("\n== Cache manifest assets ==")
    for asset in manifest_items.values():
        get_manifest_asset_bytes(asset=asset, refresh=refresh, offline=offline)


def get_external_asset_text(
    url: str,
    manifest_items: dict[str, ManifestAsset],
    refresh: bool,
    offline: bool,
) -> str:
    normalised = normalise_url(url)
    asset = manifest_items.get(normalised)

    if asset is None:
        inferred_type = guess_asset_type(normalised)
        if inferred_type not in ("js", "css"):
            fail(f"Cannot infer JS/CSS asset type from URL:\n  {url}")

        inferred_name = safe_filename(Path(urllib.parse.urlsplit(normalised).path).name)
        if not inferred_name:
            digest = hashlib.sha256(normalised.encode("utf-8")).hexdigest()[:10]
            inferred_name = f"asset-{digest}.{inferred_type}"

        asset = ManifestAsset(
            url=normalised,
            filename=inferred_name,
            asset_type=inferred_type,
            sha256="",
        )

    data = get_manifest_asset_bytes(asset=asset, refresh=refresh, offline=offline)

    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        fail(f"Cached remote asset is not UTF-8 text:\n  {url}")


def cache_path_for_url(url: str) -> Path:
    parsed = urllib.parse.urlsplit(url)
    basename = safe_filename(Path(parsed.path).name)
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]
    return CACHE_DIR / f"{digest}-{basename}"


def get_remote_bytes(url: str, refresh: bool, offline: bool) -> bytes:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = cache_path_for_url(url)

    if path.is_file() and path.stat().st_size > 0 and not refresh:
        return path.read_bytes()

    if offline:
        fail(
            "Offline mode is enabled and this URL is not cached:\n"
            f"  {url}"
        )

    data = download_bytes(url)
    write_bytes_atomic(path, data)
    return data


# ============================================================================
# HTML parsing and bundling
# ============================================================================


def extract_href(tag: str) -> str | None:
    match = HREF_ATTR_PATTERN.search(tag)
    return match.group(1).strip() if match else None


def extract_src(tag: str) -> str | None:
    match = SRC_ATTR_PATTERN.search(tag)
    return match.group(1).strip() if match else None


def discover_stylesheets(html: str) -> list[str]:
    refs: list[str] = []
    for tag in STYLESHEET_TAG_PATTERN.findall(html):
        href = extract_href(tag)
        if href:
            refs.append(href)
    return refs


def discover_scripts(html: str) -> list[str]:
    refs: list[str] = []
    for tag in SCRIPT_SRC_TAG_PATTERN.findall(html):
        src = extract_src(tag)
        if src:
            refs.append(src)
    return refs


def split_refs(refs: list[str]) -> tuple[list[str], list[str]]:
    local: list[str] = []
    external: list[str] = []

    for ref in refs:
        if is_external_url(ref):
            external.append(ref)
        else:
            local.append(ref)

    return local, external


def load_css_source(
    ref: str,
    manifest_items: dict[str, ManifestAsset],
    refresh: bool,
    offline: bool,
) -> str:
    if is_external_url(ref):
        return get_external_asset_text(
            url=ref,
            manifest_items=manifest_items,
            refresh=refresh,
            offline=offline,
        )

    if not ref.startswith("css/"):
        fail(f"Unsupported local stylesheet reference in template:\n  {ref}")

    path = DEV_DIR / ref
    validate_file(path)
    return read_text(path)


def inline_css_urls(
    css: str,
    css_ref: str,
    refresh: bool,
    offline: bool,
) -> str:
    def _replace(match: re.Match[str]) -> str:
        raw_url = (match.group(1) or match.group(2) or match.group(3) or "").strip()
        if not raw_url:
            return match.group(0)

        lowered = raw_url.lower()
        if lowered.startswith(("data:", "blob:", "#")):
            return match.group(0)

        if is_external_url(css_ref):
            absolute_url = normalise_url(urllib.parse.urljoin(css_ref, raw_url))
            data = get_remote_bytes(absolute_url, refresh=refresh, offline=offline)
            mime_type = guess_mime_type(absolute_url)
            return f"url('{data_uri(data, mime_type)}')"

        css_path = DEV_DIR / css_ref
        local_target = (css_path.parent / raw_url).resolve()

        if not local_target.is_file():
            # Leave unresolved local URLs unchanged so build remains tolerant.
            return match.group(0)

        data = local_target.read_bytes()
        mime_type = guess_mime_type(local_target.as_posix())
        return f"url('{data_uri(data, mime_type)}')"

    return CSS_URL_PATTERN.sub(_replace, css)


def load_js_source(
    ref: str,
    manifest_items: dict[str, ManifestAsset],
    refresh: bool,
    offline: bool,
) -> str:
    if is_external_url(ref):
        return get_external_asset_text(
            url=ref,
            manifest_items=manifest_items,
            refresh=refresh,
            offline=offline,
        )

    if not ref.startswith("javascript/"):
        fail(f"Unsupported local script reference in template:\n  {ref}")

    path = DEV_DIR / ref
    validate_file(path)
    return read_text(path)


def embed_schema_into_utils_js(source: str, embedded_schema_xml: str) -> str:
    replacement_schema = f"const _COBIE_EMBEDDED_SCHEMA = {js_string_literal(embedded_schema_xml)};"

    source, count_paths = SCHEMA_PATHS_PATTERN.subn(
        "const _COBIE_SCHEMA_PATHS = Object.freeze([]);",
        source,
        count=1,
    )
    source, count_embedded = EMBED_SCHEMA_PATTERN.subn(
        lambda _m: replacement_schema,
        source,
        count=1,
    )
    source, count_xmltext = SCHEMA_XMLTEXT_PATTERN.subn(
        "const xmlText = _COBIE_EMBEDDED_SCHEMA;",
        source,
        count=1,
    )

    if count_paths != 1 or count_embedded != 1 or count_xmltext != 1:
        fail("Unable to apply standalone COBie schema embedding overrides to utils.js")

    return source


def bundle_css(
    stylesheet_refs: list[str],
    manifest_items: dict[str, ManifestAsset],
    refresh: bool,
    offline: bool,
) -> str:
    sections: list[str] = []
    print("\n== Bundle CSS ==")

    for ref in stylesheet_refs:
        print(f"  CSS   {ref}")
        source = load_css_source(
            ref=ref,
            manifest_items=manifest_items,
            refresh=refresh,
            offline=offline,
        )
        source = inline_css_urls(
            css=source,
            css_ref=ref,
            refresh=refresh,
            offline=offline,
        )
        sections.append(source)

    combined = "\n".join(sections)
    return cssmin(combined)


def bundle_js(
    script_refs: list[str],
    manifest_items: dict[str, ManifestAsset],
    refresh: bool,
    offline: bool,
    embedded_schema_xml: str,
) -> str:
    sections: list[str] = []
    print("\n== Bundle JavaScript ==")

    for ref in script_refs:
        print(f"  JS    {ref}")
        module = Path(ref).name
        source = load_js_source(
            ref=ref,
            manifest_items=manifest_items,
            refresh=refresh,
            offline=offline,
        )

        if module == 'utils.js':
            source = embed_schema_into_utils_js(
                source=source,
                embedded_schema_xml=embedded_schema_xml,
            )

        if is_external_url(ref):
            # Vendor assets are already minified; avoid re-minifying to prevent parser regressions.
            source = strip_vendor_comments(source)
            section = source.rstrip("; \n\t\r")
        else:
            section = jsmin(source).rstrip("; \n\t\r")

        sections.append(section)

    return ";\n".join(sections) + ";"


def strip_vendor_comments(source: str) -> str:
    # Remove a leading banner block comment if present.
    source = re.sub(r"^\s*/\*[\s\S]*?\*/\s*", "", source, count=1)

    # Remove sourcemap comments that are irrelevant in standalone bundles.
    source = re.sub(r"(?m)^\s*//[#@]\s*sourceMappingURL=.*$", "", source)

    return source


def embed_favicon(html: str) -> str:
    validate_file(SVG_SOURCE)
    # Canonicalise line endings so the embedded favicon (and therefore the
    # release hash) is identical no matter how the source was checked out.
    svg_bytes = SVG_SOURCE.read_bytes().replace(b"\r\n", b"\n")
    encoded = base64.b64encode(svg_bytes).decode("ascii")
    favicon_data_uri = 'data:image/svg+xml;base64,' + encoded

    favicon_pattern = re.compile(
        r"<link\b(?=[^>]*\brel\s*=\s*['\"]icon['\"])(?=[^>]*\bhref\s*=\s*['\"][^'\"]+['\"])[^>]*>",
        flags=re.IGNORECASE,
    )

    replacement = f"<link rel=\"icon\" type=\"image/svg+xml\" href=\"{favicon_data_uri}\">"
    new_html, count = favicon_pattern.subn(lambda _m: replacement, html, count=1)

    if count == 0:
        return html

    return new_html


def build_html(
    template_html: str,
    min_css: str,
    min_js: str,
    embed_packages: bool,
) -> str:
    html = template_html

    # Remove authoring comments from the HTML template before script injection.
    html = HTML_COMMENT_PATTERN.sub("", html)

    # Keep XLSX bridge safe for environments where XLSX_CORE is not defined.
    html = XLSX_BRIDGE_PATTERN.sub(
        "<script>globalThis.XLSX_STYLE = globalThis.XLSX; if (globalThis.XLSX_CORE) { globalThis.XLSX = globalThis.XLSX_CORE; }</script>",
        html,
    )

    def _style_replacer(match: re.Match[str]) -> str:
        href = extract_href(match.group(0)) or ""
        if embed_packages:
            return ""
        return "" if not is_external_url(href) else match.group(0)

    def _script_replacer(match: re.Match[str]) -> str:
        src = extract_src(match.group(0)) or ""
        if embed_packages:
            return ""
        return "" if not is_external_url(src) else match.group(0)

    html = STYLESHEET_TAG_PATTERN.sub(_style_replacer, html)
    html = SCRIPT_SRC_TAG_PATTERN.sub(_script_replacer, html)

    html = embed_favicon(html)

    style_block = f"<style>{min_css}</style>"
    script_block = f"<script>{min_js}</script>"

    if "</head>" not in html.lower():
        fail("Template does not contain </head>.")
    if "</body>" not in html.lower():
        fail("Template does not contain </body>.")

    html = re.sub(
        r"</head>",
        lambda _m: f"{style_block}\n</head>",
        html,
        flags=re.IGNORECASE,
        count=1,
    )
    html = re.sub(
        r"</body>",
        lambda _m: f"{script_block}\n</body>",
        html,
        flags=re.IGNORECASE,
        count=1,
    )

    return minify_html_document(html)


def minify_html_document(html: str) -> str:
    # Collapse whitespace between tags while preserving text-node internals.
    html = re.sub(r">\s+<", "><", html)

    return html.strip()


# ============================================================================
# Main
# ============================================================================


def run_build(refresh: bool, offline: bool) -> None:
    validate_file(TEMPLATE_PATH)
    validate_file(QA_SCHEMA_SOURCE)
    validate_xml(QA_SCHEMA_SOURCE)
    validate_file(MANIFEST_PATH)

    template_html = read_text(TEMPLATE_PATH)
    manifest_items = parse_manifest(MANIFEST_PATH)

    ensure_manifest_cache(manifest_items=manifest_items, refresh=refresh, offline=offline)

    stylesheet_refs = discover_stylesheets(template_html)
    script_refs = discover_scripts(template_html)
    local_stylesheet_refs, _external_stylesheet_refs = split_refs(stylesheet_refs)
    local_script_refs, _external_script_refs = split_refs(script_refs)

    if not stylesheet_refs:
        fail("No stylesheet references found in dev/index.html.")
    if not script_refs:
        fail("No script references found in dev/index.html.")

    # Canonicalise line endings so the embedded schema (and therefore the
    # release hash) is identical no matter how the source was checked out.
    embedded_schema_xml = read_text_exact(QA_SCHEMA_SOURCE).replace("\r\n", "\n")

    min_css_airgapped = bundle_css(
        stylesheet_refs=stylesheet_refs,
        manifest_items=manifest_items,
        refresh=refresh,
        offline=offline,
    )
    min_js_airgapped = bundle_js(
        script_refs=script_refs,
        manifest_items=manifest_items,
        refresh=refresh,
        offline=offline,
        embedded_schema_xml=embedded_schema_xml,
    )

    min_css_local = bundle_css(
        stylesheet_refs=local_stylesheet_refs,
        manifest_items=manifest_items,
        refresh=refresh,
        offline=offline,
    )
    min_js_local = bundle_js(
        script_refs=local_script_refs,
        manifest_items=manifest_items,
        refresh=refresh,
        offline=offline,
        embedded_schema_xml=embedded_schema_xml,
    )

    output_html_airgapped = build_html(
        template_html=template_html,
        min_css=min_css_airgapped,
        min_js=min_js_airgapped,
        embed_packages=True,
    )

    output_html_local = build_html(
        template_html=template_html,
        min_css=min_css_local,
        min_js=min_js_local,
        embed_packages=False,
    )

    write_text_atomic(RELEASE_AIRGAPPED_PATH, output_html_airgapped)
    write_text_atomic(RELEASE_LOCAL_PATH, output_html_local)
    write_text_atomic(ROOT_OUTPUT_PATH, output_html_local)

    release_airgapped_size_kb = RELEASE_AIRGAPPED_PATH.stat().st_size / 1024
    release_local_size_kb = RELEASE_LOCAL_PATH.stat().st_size / 1024
    root_size_kb = ROOT_OUTPUT_PATH.stat().st_size / 1024

    print("\n== Build complete ==")
    print(f"  release (airgapped):  {RELEASE_AIRGAPPED_PATH} ({release_airgapped_size_kb:.1f} KB)")
    print(f"  release (local):      {RELEASE_LOCAL_PATH} ({release_local_size_kb:.1f} KB)")
    print(f"  root (default min):   {ROOT_OUTPUT_PATH} ({root_size_kb:.1f} KB)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build a single-file Guerrilla Ops HTML release by caching CDN assets "
            "from dev/packages/manifest.csv, embedding XML schema, and minifying CSS/JS."
        )
    )

    parser.add_argument(
        "--refresh-cache",
        action="store_true",
        help="Redownload all manifest assets even when cache files exist.",
    )

    parser.add_argument(
        "--offline",
        action="store_true",
        help="Do not download assets; fail if any required cache file is missing.",
    )

    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        run_build(refresh=args.refresh_cache, offline=args.offline)
    except Exception as exc:
        print(f"\nERROR: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())



