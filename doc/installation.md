# Installing the Docker image

This guide deploys the [`pad92/docker-h5ai`][dockerhub] image on a NAS or a
home server: Synology, QNAP, Unraid, TrueNAS SCALE, OpenMediaVault, or any
host running Portainer or Docker Compose. The [README](../README.md#install)
lists every environment variable; this page covers the parts that differ from
one platform to the next.

## Before you start

**CPU.** The image is published for `linux/amd64` and `linux/arm64`. 32-bit
ARM (`armv7`, older Raspberry Pi systems and entry-level NAS models) is not
supported.

**Tags.** `latest` follows the newest stable release. `1` and `1.5` follow
the newest release of that major or minor line, and `1.5.1` never moves. Pin
a major tag such as `pad92/docker-h5ai:1` if you want updates without
breaking changes.

**What you need to decide:**

| Setting | Container side | Typical host value |
| --- | --- | --- |
| Port | `80` | Any free port, for example `8080`. Ports 80 and 443 are usually taken by the NAS web interface. |
| Shared files | `/share` | The folder to publish, mounted read-only. |
| Thumbnail cache (optional) | `/usr/share/h5ai/_h5ai/public/cache` | An empty folder, so thumbnails survive an update. |
| Private cache (optional) | `/usr/share/h5ai/_h5ai/private/cache` | An empty folder, for folder sizes and the thumbnail database. |
| File owner | `PUID`, `PGID` | The user and group IDs of an account that can read the shared files. |

h5ai only reads `/share`, so mount it read-only. The two cache folders must
be writable; the container sets their owner at each start.

### Finding PUID and PGID

The web server and PHP run as the account `angie` (UID 100, GID 101 by
default). If that account cannot read your files, the listing stays empty or
shows `403` errors. Set `PUID` and `PGID` to the IDs of a NAS user that has
read access to the shared folder. A dedicated read-only user is a good
choice.

On most systems, open a shell and run `id` followed by the user name:

```console
$ id h5ai
uid=1027(h5ai) gid=100(users) groups=100(users)
```

Here you would set `PUID=1027` and `PGID=100`.

## Docker Compose (any host)

Create a folder for the project, for example `/srv/h5ai`, with this
`docker-compose.yml`:

```yaml
services:
  h5ai:
    image: pad92/docker-h5ai:1
    container_name: h5ai
    ports:
      - "8080:80"
    environment:
      - PUID=1000
      - PGID=1000
      - H5AI_ADMIN_PASSWORD=${H5AI_ADMIN_PASSWORD:-}
      # Uncomment to require a login for the whole site
      # - ENV_U=guest
      # - ENV_P=change-me
    volumes:
      - /path/to/files:/share:ro
      - ./cache/public:/usr/share/h5ai/_h5ai/public/cache
      - ./cache/private:/usr/share/h5ai/_h5ai/private/cache
    restart: unless-stopped
```

Put the admin password in a `.env` file next to it, readable only by you:

```bash
echo 'H5AI_ADMIN_PASSWORD=a-long-random-password' > .env
chmod 600 .env
docker compose up -d
```

Open `http://<host>:8080/`. The admin page is at
`http://<host>:8080/_h5ai/public/index.php`.

## Synology DSM

These steps use **Container Manager**, available on DSM 7.2 and later for
x86-64 models and some ARM64 models. On DSM 7.0 and 7.1 the package is called
**Docker** and offers the same settings with a different layout.

### 1. Prepare the folders and the user

1. In **File Station**, create a `docker` shared folder if you do not have
   one, then the folders `docker/h5ai/cache/public` and
   `docker/h5ai/cache/private`.
2. Optional but recommended: in **Control Panel > User & Group**, create a
   user `h5ai` with **Read only** permission on the shared folders you want
   to publish and no access to the others.
3. Find its IDs. Enable SSH in **Control Panel > Terminal & SNMP**, log in
   with an administrator account and run `id h5ai`. DSM users usually get a
   UID from 1026 upwards and the group `users` (GID 100). You can disable SSH
   again afterwards.

Shared folders live under `/volume1/<shared folder>` (or `/volume2`, and so
on). The path is shown in **File Station > Properties** of the folder.

### 2. Create the project

1. Open **Container Manager > Project > Create**.
2. Project name: `h5ai`. Path: select `docker/h5ai`.
3. Source: **Create docker-compose.yml**, then paste:

   ```yaml
   services:
     h5ai:
       image: pad92/docker-h5ai:1
       container_name: h5ai
       ports:
         - "8080:80"
       environment:
         - PUID=1027
         - PGID=100
         - H5AI_ADMIN_PASSWORD=a-long-random-password
       volumes:
         - /volume1/photo:/share:ro
         - /volume1/docker/h5ai/cache/public:/usr/share/h5ai/_h5ai/public/cache
         - /volume1/docker/h5ai/cache/private:/usr/share/h5ai/_h5ai/private/cache
       restart: unless-stopped
   ```

   Replace the IDs, the password and `/volume1/photo` with your own values.
   To publish several shared folders, mount each one below `/share`, for
   example `/volume1/music:/share/music:ro` and
   `/volume1/video:/share/video:ro`.

4. Skip the **Web portal** step, then click **Done**. DSM pulls the image
   and starts the container.

Open `http://<nas-address>:8080/`. If DSM's firewall is enabled, allow port
8080 in **Control Panel > Security > Firewall**.

To use the UI instead of a compose file: **Registry**, search
`pad92/docker-h5ai`, download the `1` tag, then **Image > Run**. In the
advanced settings, map local port `8080` to container port `80`, add the
folders above under **Volume Settings** (tick **Read-only** for the shared
folder), and add `PUID`, `PGID` and `H5AI_ADMIN_PASSWORD` under
**Environment**.

### 3. Customize the options

h5ai hides DSM's `@eaDir` indexing folders, the `#recycle` bin and
`#snapshot` by default. To change other settings, copy the default
`options.json` out of the image:

```bash
cd /volume1/docker/h5ai
docker run --rm --entrypoint cat pad92/docker-h5ai:1 \
  /usr/share/h5ai/_h5ai/private/conf/options.json > options.json
```

Edit it, then mount the file in the project and rebuild it:

```yaml
      - /volume1/docker/h5ai/options.json:/usr/share/h5ai/_h5ai/private/conf/options.json
```

Keep this mount writable while `H5AI_ADMIN_PASSWORD` is set: the container
writes the password hash into it at each start, and refuses to start if it
cannot. After an update, compare your copy with the new default to pick up
new options. The [configuration guide](configuration.md) describes every
setting.

### 4. HTTPS with the DSM reverse proxy

To serve h5ai on its own name with DSM's certificate:

1. **Control Panel > Login Portal > Advanced > Reverse Proxy > Create**.
2. Source: `HTTPS`, hostname `files.example.com`, port `443`.
   Destination: `HTTP`, `localhost`, port `8080`.
3. In **Custom Header**, add `X-Forwarded-For` with the value
   `$proxy_add_x_forwarded_for` if it is not already listed.
4. Add `REAL_IP_FROM=172.16.0.0/12` to the container environment. Requests
   from the reverse proxy reach the container through the Docker bridge
   network, so without it every visitor shares the address of the bridge
   gateway, in the logs and in the admin login rate limit.

Pick the certificate for `files.example.com` in **Control Panel > Security >
Certificate > Settings**.

## QNAP (Container Station)

1. Find the IDs of the user that should read the files: enable SSH in
   **Control Panel > Network & File Services > Telnet / SSH**, then run
   `id <user>`.
2. In **Container Station 3**, open **Applications > Create**, name it
   `h5ai`, and paste the [compose file](#docker-compose-any-host) with
   absolute paths. Shared folders are under `/share`, for example
   `/share/Multimedia:/share:ro` and
   `/share/Container/h5ai/cache/public:/usr/share/h5ai/_h5ai/public/cache`.
3. Click **Create**, then open `http://<nas-address>:8080/`.

h5ai hides QNAP's `.@__thumb` thumbnail folders, `@Recycle` and
`@Recently-Snapshot` by default.

## Unraid

In the **Docker** tab, click **Add Container** and fill in:

| Field | Value |
| --- | --- |
| Name | `h5ai` |
| Repository | `pad92/docker-h5ai:1` |
| Network Type | `Bridge` |
| Port | Container port `80`, host port `8080` |
| Path | Container path `/share`, host path `/mnt/user/media`, access mode **Read Only** |
| Path | `/usr/share/h5ai/_h5ai/public/cache` on `/mnt/user/appdata/h5ai/cache/public` |
| Path | `/usr/share/h5ai/_h5ai/private/cache` on `/mnt/user/appdata/h5ai/cache/private` |
| Variable | `PUID` = `99` |
| Variable | `PGID` = `100` |
| Variable | `H5AI_ADMIN_PASSWORD` = your password |

`99:100` is Unraid's `nobody:users`, which owns the files of user shares by
default. Use **Add another Path, Port, Variable...** for each line, then
**Apply**.

## TrueNAS SCALE

On TrueNAS SCALE 24.10 and later, open **Apps > Discover Apps**, then the
menu next to **Custom App** and **Install via YAML**. Paste the
[compose file](#docker-compose-any-host) with dataset paths, for example
`/mnt/tank/media:/share:ro` and
`/mnt/tank/apps/h5ai/cache/public:/usr/share/h5ai/_h5ai/public/cache`.

Set `PUID` and `PGID` to the owner of the dataset, or to the built-in `apps`
user (`568`) after giving it read permission on the dataset in
**Datasets > Edit Permissions**.

## Portainer

**Stacks > Add stack**, name it `h5ai`, and paste the
[compose file](#docker-compose-any-host) in the web editor with absolute
paths. Instead of a `.env` file, add `H5AI_ADMIN_PASSWORD` under
**Environment variables** at the bottom of the page, then click **Deploy the
stack**.

## OpenMediaVault

Install the `openmediavault-compose` plugin, set its shared folder in
**Services > Compose > Settings**, then add the
[compose file](#docker-compose-any-host) in **Services > Compose > Files**.
Shared folders are mounted under `/srv/dev-disk-by-uuid-<id>/<folder>`; the
full path is shown in **Storage > Shared Folders**. OMV users get UIDs from
1000 and the `users` group (GID 100).

## Updating

With Compose or Portainer, pull the new image and recreate the container:

```bash
docker compose pull
docker compose up -d
```

On Synology, run the same two commands over SSH with `sudo`, from the
project folder (`/volume1/docker/h5ai`). In Unraid, click **Check for
Updates** in the Docker tab, then **apply update**.

Persisted caches are kept. The container drops its list of available tools
at each start, so a tool added to a newer image is detected on the first
request.

## Troubleshooting

**The listing is empty or shows "403".** The `angie` account cannot read the
files. Check `PUID` and `PGID`, and the permissions of the folder on the NAS.
The container log starts with `Remapping user 'angie' -> UID ...` when the
remapping is applied.

**The container restarts in a loop.** Read its log. Two settings make startup
fail on purpose: `ENV_U`/`ENV_P` when the password file cannot be written,
and `H5AI_ADMIN_PASSWORD` when `options.json` is mounted read-only.

**No thumbnails.** Open the admin page: it lists every tool the thumbnails
need and the state of the background tasks. The cache folders must be
writable by the container.

**The NAS disks never go to sleep.** At its first start, then once a day,
h5ai's cache warmer reads the whole share to create thumbnails and compute
folder sizes. Set `cache.warmAtStartup` to `false` in a
[custom `options.json`](#3-customize-the-options) to stop it; thumbnails are
then created when a folder is first opened. An open h5ai tab also refreshes
its folder every 5 seconds while it is visible (`autorefresh`).

**The container is marked unhealthy.** The health check requests
`GET /healthz` from Angie inside the container, outside basic authentication.
A failure means Angie is not answering; its errors are in the container log.

[dockerhub]: https://hub.docker.com/r/pad92/docker-h5ai
