# Migration script not found after pushing main

`db:rolling-service-schedule` and `db:admin-coaching-discounts` are scripts in the **backend** `package.json`. They are not frontend scripts, and pushing Git commits does not update an already running Docker container. The main workflow must pass lint, typecheck and tests, then build and deploy its image successfully.

For a host checkout, run from the backend directory:

```sh
git pull --ff-only origin main
bun run db:rolling-service-schedule
bun run db:admin-coaching-discounts
bun run db:offline-payment-methods
```

For a deployed Docker application, first ensure the new image finished deployment. Then check the scripts inside the actual application container (the production default is shown):

```sh
docker exec -w /app quantum-sport-app-prod bun run
```

If the scripts are absent there, the running image is old or the container name/environment is different. Updating the host Git checkout alone does not replace that image. Review the backend **Build & Deploy to DigitalOcean** workflow and its deployment result.

The updated container entrypoint automatically applies the additive rolling-service, admin-coaching-discount and offline-payment schemas before application startup. Their SQL files and runtime shell scripts are included in the image, and Prisma CLI is a production dependency. Existing methods remain available for manual non-Docker deployments.

Local verification cannot establish the image currently running on a remote VPS. Check the Actions run and container logs to confirm deployment and migration completion.
