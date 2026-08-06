#!/usr/bin/env python3
"""
Build script for Guerrilla Ops
Combines dev/index.html with all CSS and JS modules into a single
self-contained HTML file written to release/Guerrilla-Ops.html.

Usage:
    python build_release.py
"""
import importlib
import os
import re

try:
    cssmin = importlib.import_module('rcssmin').cssmin
except ImportError:
    cssmin = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.dirname(SCRIPT_DIR)
DEV_DIR     = os.path.join(ROOT_DIR, 'dev')
CSS_DIR     = os.path.join(DEV_DIR, 'css')
JS_DIR      = os.path.join(DEV_DIR, 'javascript')
RELEASE_DIR = os.path.join(ROOT_DIR, 'release')
SVG_SOURCE = os.path.join(DEV_DIR, 'svgs', 'Guerrilla-Ops.svg')


def read(path):
    with open(path, 'r', encoding='utf-8') as fh:
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
    html = read(template_path)
    css_files, js_modules = local_assets(html)
    for filename in css_files:
        validate_source(os.path.join(CSS_DIR, filename))
    for filename in js_modules:
        validate_source(os.path.join(JS_DIR, filename))
    svg_markup = read(SVG_SOURCE).strip()

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
        if module == 'logo-theme.js':
            module_source = module_source.replace("const EMBEDDED_LOGO_SVG = '';", f"const EMBEDDED_LOGO_SVG = {js_string_literal(svg_markup)};")
        js_parts.append(f'// ── {module} {"─" * max(1, 50 - len(module))}\n\n' + module_source)
    combined_js = '\n\n'.join(js_parts)

    # Remove all individual <script src="javascript/..."> tags
    html = re.sub(r'\n?<script src="javascript/[^"]+\.js"></script>', '', html)

    # Insert combined JS before </body>
    html = html.replace(
        '</body>',
        f'<script>\n{combined_js}\n</script>\n\n</body>'
    )

    # ── Write output ───────────────────────────────────────────
    output_path = os.path.join(RELEASE_DIR, 'Guerrilla-Ops.html')
    root_path   = os.path.join(ROOT_DIR, 'index.html')
    root_html = minify_html(html)
    validate_compacted_html(html, root_html)
    with open(output_path, 'w', encoding='utf-8') as fh:
        fh.write(html)
    with open(root_path, 'w', encoding='utf-8') as fh:
        fh.write(root_html)

    css_kb   = sum(len(p.encode('utf-8')) for p in css_parts) / 1024
    js_kb    = len(combined_js.encode('utf-8')) / 1024
    total_kb = len(html.encode('utf-8')) / 1024
    print(f'Built:  {output_path}')
    print(f'  copy: {root_path}')
    print(f'  CSS:  {css_kb:.1f} KB')
    print(f'  JS:   {js_kb:.1f} KB  ({len(js_modules)} modules)')
    print('  SVG:  embedded into bundled JS')
    print(f'  Total:{total_kb:.1f} KB')


if __name__ == '__main__':
    build()
