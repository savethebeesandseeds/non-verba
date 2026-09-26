# Homepage deployment

The homepage is published to `https://non-verba.com` with GitHub Pages. The
workflow in `.github/workflows/pages.yml` exports the page on relevant pushes to
`main`, and can also be started manually from GitHub Actions. Select **GitHub
Actions** as the Pages build source in the repository settings.

From the repository root, generate the same static bundle locally with Node.js
22 or newer:

```sh
node code/tools/export-homepage.mjs
```

The command replaces only the generated `code/artifacts/pages/` directory with
these files:

```text
index.html
index.css
branding/sprout.svg
branding/waajacu-favicon.png
branding/individual/01-sprout.png
CNAME
.nojekyll
```

The export retains the production Content Security Policy. It includes no local
review page, simulator, original branding sheet, concept images, other character
images, documentation, or private application files. No package installation or
Rust/WASM build is needed.

Set `non-verba.com` as the custom domain in the repository's Pages settings and
configure its DNS in Cloudflare to point to GitHub Pages. The generated `CNAME`
also records this domain; an Actions deployment still requires the custom-domain
setting in GitHub. Once DNS verification and certificate provisioning complete,
enable **Enforce HTTPS** in GitHub Pages. These account settings are separate from
the workflow and cannot be enabled by its static files.

References: [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site),
[securing a Pages site with HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https),
and [GitHub's static Pages workflow](https://github.com/actions/starter-workflows/blob/main/pages/static.yml).
