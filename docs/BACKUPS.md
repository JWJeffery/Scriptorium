# Backups

Every night at 03:00 (server time) `deploy/backup.sh`:

1. dumps the database (every book's record, highlight, note, tag, citation, thread) and checks the dump can be read
   back; the newest 3 dumps stay on the server in `/var/backups/scriptorium`;
2. copies that dump to your Google Drive (`Scriptorium/database`, 30 days kept), and brings Drive's copy of your
   uploaded files up to date (`Scriptorium/files`). Only changed files are sent. A file that changed or was deleted
   on the server is moved on Drive into `Scriptorium/files-replaced/<date>` (kept 90 days) instead of being lost;
3. writes a report the app reads. If the last good off-server backup is more than 36 hours old, failed, or Drive is
   not connected, every page shows a **Backups need attention** banner saying why.

It costs nothing: Google's free 15 GB is shared with your Gmail and Photos. A 40 MB book means roughly 300 books fit
alongside a modest mailbox. Drive's storage page shows what is left.

Backups are also taken by `deploy/update.sh` before every update. Run one by hand any time:
`cd /opt/scriptorium && ./deploy/backup.sh`. The log is `/var/log/scriptorium-backup.log`.

## Connect Google Drive (once)

On your **Mac**, in Terminal:

```
brew install rclone
rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"
```

(No Homebrew? Use `sudo -v ; curl https://rclone.org/install.sh | sudo bash` instead of the first line.)
A browser opens: sign in to Google and allow access. The odd text in quotes asks for the narrowest permission:
Scriptorium can see only the files it creates in your Drive. Terminal then prints a long line starting with
`{"access_token":` and ending with `}`. Copy that whole line.

On the **server**:

```
cd /opt/scriptorium && ./deploy/connect-google-drive.sh
```

Paste the line when asked. A `Scriptorium` folder appears in your Drive. Then run the first backup (it sends your
whole library once, so it can take a while; later nights send only what changed):

```
./deploy/backup.sh
```

The banner disappears once a backup reaches Drive.

## Restore

`deploy/restore.sh` **replaces** the library on the server it runs on.

**The server was lost (or you are moving to a new one):**

1. Create the new server and follow `docs/DEPLOY_VM.md` steps 1-3 (clone to `/opt/scriptorium`, create
   `.env.production`; keep your passwords in a password manager, because they are deliberately not in the backup).
2. Connect Google Drive as above.
3. `cd /opt/scriptorium && ./deploy/restore.sh` and type `RESTORE` when asked. It starts the database, copies your
   files back from Drive, restores the newest database dump, and starts Scriptorium.
4. `./deploy/server-setup.sh` to schedule backups again.

**Undo a bad day on the same server** (restore the dump from before it):

```
ls -1t /var/backups/scriptorium/db-*.dump     # newest first
./deploy/restore.sh /var/backups/scriptorium/db-XXXX.dump
```

(Older dumps are on Drive under `Scriptorium/database`.)

This whole cycle (back up, delete every volume, restore, check a book, its exact PDF bytes and its highlight came
back) runs automatically in GitHub's "Production stack (Docker)" check on every change.

## The in-app "Download backup" button

Still there, for a ZIP of everything you can keep on your own computer. Only the newest 3 such ZIPs are kept on the
server; the nightly backup does not use them.

## Optional second copy

`deploy/backup.sh` can copy to any rclone destination: set `DRIVE_REMOTE` in `/etc/cron.d/scriptorium` to another
remote you add to `deploy/rclone/rclone.conf` (for example an SFTP login on the Spaceship shared hosting you already
pay for). Google Drive alone is the supported setup.
