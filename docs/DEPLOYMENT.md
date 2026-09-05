# Deployment

Run deployment commands from this repository, `/Users/nking/Documents/football-companion`.
The similarly named `/Users/nking/Documents/ChatGPT/Football Companion` folder is an empty repository.

- Project: `football-companion`
- Team: `nates-projects-925609f4`
- Production: https://fluentin.football
- Vercel fallback: https://football-companion-rose.vercel.app
- Companion at `/`; frozen v0 instrument at `/stopwatch`.
- `vercel.json` supplies the static build. No backend or runtime secrets are needed.

## Custom domain

`fluentin.football` is assigned to the same Vercel project. Name.com hosts its DNS. On September 5, 2026, its default parking answer was replaced with Vercel's recommended apex A records `216.150.1.1` and `216.150.16.1`, TTL 300. Nameservers stay at Name.com. Vercel handles the HTTPS certificate; there is no need to buy a registrar SSL product.

After DNS changes, check `vercel domains inspect fluentin.football --scope nates-projects-925609f4` and verify normal HTTPS before reporting the new address ready. A successful deployment alone does not prove the custom domain resolves.

## Git identity

On 2026-09-05, Vercel blocked CLI deployments whose commit author was the Mac's
automatic `nking@Nates-MacBook-Air.local` identity. The authenticated CLI user was
already the team owner. GitHub associates `nathan.king@me.com` with `natebking`,
and deployments using that author succeeded.

This checkout now saves the following repository-local settings, shared by Codex,
Claude, and ordinary Git commands. Apply them again when making a fresh clone:

```sh
git config --local user.name 'Nathan King'
git config --local user.email 'nathan.king@me.com'
git var GIT_AUTHOR_IDENT
```

Git settings affect future commits. Inspect the actual commit before deploying:

```sh
git log -1 --format='%h %an <%ae>'
node --check web/app.js
vercel deploy --prod --yes --scope nates-projects-925609f4
```

Do not add the placeholder identity as a paid collaborator or rewrite published
history to fix this. See [Vercel's commit attribution guidance](https://vercel.com/docs/deployments/troubleshoot-project-collaboration).

## Verify and diagnose

Use the deployment URL printed by the CLI:

```sh
vercel inspect <deployment-url> --scope nates-projects-925609f4
vercel inspect <deployment-url> --logs --scope nates-projects-925609f4
vercel curl /app.js --deployment <deployment-url>
```

Preview URLs have deployment protection. A login redirect alone does not mean
the build failed. Leave protection enabled and use authenticated `vercel curl`.
CLI 54.14.5 labels blocked deployments `UNKNOWN`; the REST deployment object's
`readyState` distinguishes `BLOCKED` from `READY`.

The Codex Vercel connector returned no teams and a 403 for this project during
the incident. Its connection needs to be reconnected to the existing team-owner
account. The browser and shared local Vercel CLI already access the team as
`support-2173`; their successful authentication does not repair a separate
connector's authorization.

As checked on 2026-09-05, the Vercel project has no Git integration (`link: null`).
A GitHub push, including the weekly tendency refresh, does not by itself deploy
the site. Deploy explicitly after validating changes.
