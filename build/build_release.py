#!/usr/bin/env python3
"""
Build script for Guerrilla Ops
Combines dev/index.html with all CSS and JS modules into a single
self-contained HTML file written to release/Guerrilla-Ops.html.

Usage:
    python build_release.py
"""
import base64
import hashlib
import importlib
import os
import re

try:
    cssmin = importlib.import_module('rcssmin').cssmin
except ImportError:
    cssmin = None
try:
    jsmin = importlib.import_module('rjsmin').jsmin
except ImportError:
    jsmin = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.dirname(SCRIPT_DIR)
DEV_DIR     = os.path.join(ROOT_DIR, 'dev')
CSS_DIR     = os.path.join(DEV_DIR, 'css')
JS_DIR      = os.path.join(DEV_DIR, 'javascript')
RELEASE_DIR = os.path.join(ROOT_DIR, 'release')
SVG_SOURCE = os.path.join(DEV_DIR, 'svgs', 'Guerrilla-Ops.svg')
QA_SCHEMA_SOURCE = os.path.join(DEV_DIR, 'specification', 'ids_cobie.xml')


def read(path):
    with open(path, 'r', encoding='utf-8') as fh:
        return fh.read()


def read_exact(path):
    with open(path, 'r', encoding='utf-8', newline='') as fh:
        return fh.read()


def js_string_literal(text):
    return repr(text)


def local_assets(html):
    css_files = re.findall(r'<link\b[^>]*href="css/([^"]+\.css)"', html, flags=re.IGNORECASE)
    js_modules = re.findall(r'<script\b[^>]*src="javascript/([^"]+\.js)"[^>]*></script>', html, flags=re.IGNORECASE)
    if not css_files:
        raise ValueError('No local CSS files found in dev/index.html')
    if not js_modules:
        raise ValueError('No local JavaScript modules found in dev/index.html')
    return css_files, js_modules


def validate_source(path):
    if not os.path.isfile(path):
        raise FileNotFoundError(f'Missing build source: {path}')
    if os.path.getsize(path) == 0:
        raise ValueError(f'Empty build source: {path}')


def minify_html(html):
    protected_blocks = []

    def protect_block(match):
        opening, tag, body, closing = match.groups()
        if tag.lower() == 'style' and cssmin is not None and body.strip():
            body = cssmin(body)
        token = f'\x00PROTECTED_BLOCK_{len(protected_blocks)}\x00'
        protected_blocks.append(opening + body + closing)
        return token

    html = re.sub(
        r'(<(script|style)\b[^>]*>)(.*?)(</\2>)',
        protect_block,
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )
    html = re.sub(r'<!--(?!\s*\[if).*?-->', '', html, flags=re.DOTALL)
    html = re.sub(r'>\s+<', '><', html)
    html = html.strip()
    for index, block in enumerate(protected_blocks):
        html = html.replace(f'\x00PROTECTED_BLOCK_{index}\x00', block)
    return html


def validate_compacted_html(source, compacted):
    script_pattern = r'<script\b[^>]*>(.*?)</script>'
    source_scripts = re.findall(script_pattern, source, flags=re.DOTALL | re.IGNORECASE)
    compacted_scripts = re.findall(script_pattern, compacted, flags=re.DOTALL | re.IGNORECASE)
    if source_scripts != compacted_scripts:
        raise ValueError('HTML compaction changed JavaScript or embedded SVG content')


def build():
    os.makedirs(RELEASE_DIR, exist_ok=True)

    # ── Load template ──────────────────────────────────────────
    template_path = os.path.join(DEV_DIR, 'index.html')
    validate_source(template_path)
    validate_source(SVG_SOURCE)
    validate_source(QA_SCHEMA_SOURCE)
    html = read(template_path)
    css_files, js_modules = local_assets(html)
    for filename in css_files:
        validate_source(os.path.join(CSS_DIR, filename))
    for filename in js_modules:
        validate_source(os.path.join(JS_DIR, filename))
    svg_markup = read(SVG_SOURCE).strip()
    qa_schema = read_exact(QA_SCHEMA_SOURCE)
    if 'profile="NBIMS-US-V3-current-rules"' not in qa_schema or 'version="2.0"' not in qa_schema:
        raise ValueError('QA schema source is not the required NBIMS-US-V3 current-rules v2.0 profile')
    qa_schema_literal = js_string_literal(qa_schema)
    svg_data_url = 'data:image/svg+xml;base64,' + base64.b64encode(svg_markup.encode('utf-8')).decode('ascii')
    favicon_source = '<link rel="icon" type="image/svg+xml" href="svgs/Guerrilla-Ops.svg">'
    if favicon_source not in html:
        raise ValueError('Missing canonical SVG favicon link in dev/index.html')
    html = html.replace(favicon_source, f'<link rel="icon" type="image/svg+xml" href="{svg_data_url}">')

    # ── Inline CSS ─────────────────────────────────────────────
    css_parts = [read(os.path.join(CSS_DIR, filename)) for filename in css_files]
    css = '\n\n'.join(css_parts)
    # Replace the first CSS link and remove the rest
    first_link = f'<link rel="stylesheet" href="css/{css_files[0]}">'
    html = html.replace(first_link, f'<style>\n{css}\n  </style>')
    for filename in css_files[1:]:
        html = html.replace(f'\n  <link rel="stylesheet" href="css/{filename}">', '')

    # ── Concatenate JS modules ─────────────────────────────────
    js_parts = []
    for module in js_modules:
        path = os.path.join(JS_DIR, module)
        module_source = read(path)
        if module == 'utils.js':
            schema_marker = "const _COBIE_EMBEDDED_SCHEMA = '';"
            schema_paths = "const _COBIE_SCHEMA_PATHS = Object.freeze(['dev/specification/ids_cobie.xml', 'specification/ids_cobie.xml']);"
            schema_loader = 'const xmlText = _COBIE_EMBEDDED_SCHEMA || _cobieReadXmlSync(_COBIE_SCHEMA_PATHS);'
            if schema_marker not in module_source:
                raise ValueError('Missing utils schema embed marker in utils.js')
            if schema_paths not in module_source:
                raise ValueError('Missing utils schema path declaration in utils.js')
            if schema_loader not in module_source:
                raise ValueError('Missing utils schema loader in utils.js')
            module_source = module_source.replace(schema_paths, 'const _COBIE_SCHEMA_PATHS = Object.freeze([]);')
            module_source = module_source.replace(schema_loader, 'const xmlText = _COBIE_EMBEDDED_SCHEMA;')
            module_source = module_source.replace(
                schema_marker,
                f'const _COBIE_EMBEDDED_SCHEMA = {qa_schema_literal};',
            )
            if f'const _COBIE_EMBEDDED_SCHEMA = {qa_schema_literal};' not in module_source:
                raise ValueError('Utils schema embedding did not preserve the exact XML source')
        js_parts.append(f'// ── {module} {"─" * max(1, 50 - len(module))}\n\n' + module_source)
    combined_js = '\n\n'.join(js_parts)
    if '_qaDefaultSchema' in combined_js or 'fallbackUsed' in combined_js:
        raise ValueError('Legacy QA fallback code must not be included in standalone builds')
    if 'specification/ids_cobie.xml' in combined_js:
        raise ValueError('Standalone builds must not reference an external QA XML file')
    if '_COBIE_EMBEDDED_SCHEMA || _cobieReadXmlSync' in combined_js:
        raise ValueError('Standalone builds must load COBie metadata exclusively from embedded XML')
    bundled_js = jsmin(combined_js) if jsmin is not None else combined_js

    # Remove all individual <script src="javascript/..."> tags
    html = re.sub(r'\n?<script src="javascript/[^"]+\.js"></script>', '', html)

    # Insert combined JS before </body>
    html = html.replace(
        '</body>',
        f'<script>\n{bundled_js}\n</script>\n\n</body>'
    )

    # ── Write output ───────────────────────────────────────────
    output_path = os.path.join(RELEASE_DIR, 'Guerrilla-Ops.html')
    root_path   = os.path.join(ROOT_DIR, 'index.html')
    root_html = minify_html(html)
    validate_compacted_html(html, root_html)
    embedded_schema_marker = 'const _COBIE_EMBEDDED_SCHEMA'
    if embedded_schema_marker not in html or embedded_schema_marker not in root_html:
        raise ValueError('Generated standalone HTML does not contain the embedded QA XML declaration')
    with open(output_path, 'w', encoding='utf-8') as fh:
        fh.write(html)
    with open(root_path, 'w', encoding='utf-8') as fh:
        fh.write(root_html)

    css_kb   = sum(len(p.encode('utf-8')) for p in css_parts) / 1024
    js_kb    = len(bundled_js.encode('utf-8')) / 1024
    total_kb = len(html.encode('utf-8')) / 1024
    print(f'Built:  {output_path}')
    print(f'  copy: {root_path}')
    print(f'  CSS:  {css_kb:.1f} KB')
    print(f'  JS:   {js_kb:.1f} KB  ({len(js_modules)} modules, {"minified" if jsmin else "unminified"})')
    print('  SVG:  hardcoded logo JS with embedded favicon')
    print(f'  QA:   NBIMS-US-V3-current-rules v2.0 ({hashlib.sha256(qa_schema.encode("utf-8")).hexdigest()[:12]})')
    print(f'  Total:{total_kb:.1f} KB')


if __name__ == '__main__':
    build()
