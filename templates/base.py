"""Shared HTML document shell."""

from .styles import COMMON_CSS


def wrap_page(title, body_html, page_css="", page_js=""):
    """Wrap body content in a full HTML document with shared styles."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
{COMMON_CSS}
{page_css}
</style>
</head>
<body>
{body_html}
<div class="toast" id="toast"></div>
<script>
{page_js}
</script>
</body>
</html>"""
