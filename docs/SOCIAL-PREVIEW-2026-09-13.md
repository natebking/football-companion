# Social link preview — September 13, 2026

The shared homepage had a title and description but no Open Graph image or X card metadata. Fetching production as `Twitterbot/1.0` confirmed those omissions in the HTML. The page returned HTTP 200; there was no login or crawler challenge in that response. `/robots.txt` returned 404, rather than a rule excluding the crawler.

The homepage now supplies `og:type`, an absolute `og:image` URL with dimensions and alternative text, and explicit `twitter:card`, title, description, image, alternative text, and creator tags. They are present in the initial HTML and do not depend on JavaScript. The image is a 1200 × 630 PNG, 58,696 bytes, using the existing dark brand colors and route logo.

- Published image: https://fluentin.football/social-preview-v1.png
- Editable image source: `docs/assets/social-preview.svg`. Render with the DM Sans fonts from `web/fonts`; the PNG is committed, so deployment needs no graphics dependency. For future image changes, use a new filename and update both image tags to avoid reusing an old image URL.
- Implementation commit: `733d2c1`.
- Verified preview: `dpl_14rscUsxiLpzhiFcAjvmPfXgcsLP`.
- Production promotion: `dpl_9Qp3a7Pg89LQpYbXhZoZCTK5uqpy`.
- Artifact manifest: `bb2d533c304fd7a17372d22c7ffb27b37cf22347b1ff846dcde7d2d946a8b2eb` (48 assets).

Validation checked unique metadata, the built image's format and dimensions, and all preview/production asset hashes against the local build. Public requests using `Twitterbot/1.0` received the new HTML and exact PNG bytes with the correct content types. An HTTP bare-domain request followed the 308 redirect to the HTTPS page with the same tags. These checks establish that the site supplies a usable card; they do not establish when X will fetch it or replace any cached result.

X's authenticated [Card Validator](https://cards-dev.twitter.com/validator) then fetched the production homepage and reported 26 meta tags, `twitter:card = summary_large_image`, and **Card loaded successfully**. The validator says its visual preview has moved to Tweet Composer. A composer check did not show a visual card for either the root URL or a fresh `?share=launch` query at the time of testing. The validator result confirms X's fetch succeeded; it does not prove a particular timeline or composer will display it immediately.

The original X post has not been deleted or replaced. A replacement text was prepared in an unpublished composer for review. Keep the existing post until a replacement's presentation is satisfactory; an attached product screenshot can also provide the visual directly.

The Open Graph fields follow the [Open Graph protocol](https://ogp.me/). The former X card documentation URLs redirected to its general developer overview during this investigation, so no specific cache expiration time is assumed.
