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
index.js
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

GitHub Pages is configured with `non-verba.com` as its custom domain and **Enforce
HTTPS** enabled. The certificate covers both `non-verba.com` and
`www.non-verba.com`. HTTP and the `www` variant redirect to
`https://non-verba.com/`.

Cloudflare provides DNS only, with these records (proxy disabled):

| Name | Type | Target |
| --- | --- | --- |
| `@` | A | `185.199.108.153` |
| `@` | A | `185.199.109.153` |
| `@` | A | `185.199.110.153` |
| `@` | A | `185.199.111.153` |
| `@` | AAAA | `2606:50c0:8000::153` |
| `@` | AAAA | `2606:50c0:8001::153` |
| `@` | AAAA | `2606:50c0:8002::153` |
| `@` | AAAA | `2606:50c0:8003::153` |
| `www` | CNAME | `savethebeesandseeds.github.io` |

The generated `CNAME` also records the custom domain; an Actions deployment
still requires the custom-domain setting in GitHub. Hosting and certificate
renewal are handled by GitHub Pages; no Cloudflare Tunnel or local server is
needed for the public site.

References: [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site),
[securing a Pages site with HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https),
and [GitHub's static Pages workflow](https://github.com/actions/starter-workflows/blob/main/pages/static.yml).
