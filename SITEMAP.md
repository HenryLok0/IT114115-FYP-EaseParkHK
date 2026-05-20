# Sitemap generator (this repo)

This repository generates **`sitemap.xml` only** for [EaseParkHK](https://easeparkhk.henrylok.me), published via **GitHub Pages** from the `docs/` folder.

## URLs

| What | URL |
|------|-----|
| Hosted sitemap file | `https://henrylok0.github.io/IT114115-FYP-EaseParkHK/sitemap.xml` |
| URLs listed inside the file | `https://easeparkhk.henrylok.me/...` |

## GitHub Pages setup

1. **Settings → Pages**
2. Source: branch `main`, folder **`/docs`**
3. Save (do not use custom domain `easeparkhk.henrylok.me` here — that stays on your app server)

## Main site `robots.txt`

On `easeparkhk.henrylok.me`, point crawlers to this sitemap:

```
Sitemap: https://henrylok0.github.io/IT114115-FYP-EaseParkHK/sitemap.xml
```

## Automation

- Workflow: `.github/workflows/generate-sitemap.yml`
- Schedule: daily 02:00 UTC
- Manual run: **Actions → Generate sitemap → Run workflow**

## Local run

```bash
pip install requests
python scripts/generate_sitemap.py
```

Output: `docs/sitemap.xml`
