# Deploying SpeakSure on an Oracle Cloud Always Free ARM instance

Target: one `VM.Standard.A1.Flex` (Ampere ARM) instance running **Ubuntu 24.04
Minimal (aarch64)**. Verified against **1 OCPU / 8 GB RAM**, which is comfortably
enough. This is within the Always Free allowance — it costs nothing.

Measured on this stack:

| | |
|---|---|
| Resident memory per worker | **~1.3 GB** peak (so 2 workers fit in 8 GB with room to spare) |
| Wav2Vec2, per 10s chunk, 1 thread | **~0.2s** on Apple Silicon; budget 2-4x that on an A1 core |
| Model load at startup | ~4s local, expect 10-20s on A1 |

CPU is **not** the bottleneck — a 60-second answer is ~6 chunks, a few seconds of
compute. Nearly all of a request's wall time is waiting on the AssemblyAI and
Gemini APIs.

Two things to know:

- The 1 GB `E2.1.Micro` x86 free shape **cannot** run this app. Stay on A1.
- Ubuntu 24.04 ships **Python 3.12**. Every dependency has a prebuilt `cp312`
  aarch64 wheel, so nothing compiles from source, and glibc 2.39 satisfies the
  `torch` aarch64 wheel's 2.28+ requirement.

> **You can scale this up for free.** The Always Free A1 allowance is 4 OCPU /
> 24 GB *in total*. At 1 OCPU / 8 GB you are using a quarter of it. A1.Flex
> supports resizing in place (Instance → Edit → Edit shape, then reboot) if
> capacity is available in your AD — worth doing, though nothing here requires it.

---

## 1. Provision

OCI console → Compute → Create Instance:

- Image: **Ubuntu 24.04 Minimal (aarch64)**
- Shape: **VM.Standard.A1.Flex**, 1 OCPU / 8 GB (or up to 4 / 24, same cost)
- Boot volume: **50 GB** (Always Free gives 200 GB of block storage in total)
- Add your SSH public key

Then **VCN → Security List → Ingress Rules**: allow `0.0.0.0/0` on TCP **80** and **443**.

> If you hit **"Out of host capacity"**, that is the usual free-tier obstacle.
> Try each Availability Domain in your region, then retry on a loop — capacity
> frees up constantly. Upgrading to Pay As You Go measurably improves A1
> availability and Always Free resources stay free, but the guardrail is gone,
> so set a budget alert first.

## 2. Open the host firewall

Oracle's Ubuntu images ship a restrictive `iptables` chain *on top of* the cloud
security list. Both must be open or you get a silent timeout.

```bash
ssh ubuntu@<public-ip>
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. System packages

The **Minimal** image is stripped down, so this list is longer than it would be
on a standard image — `curl`, `rsync` and the iptables tooling are not preinstalled.

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.12 python3.12-venv python3-pip \
  nginx git curl rsync ffmpeg libsndfile1 build-essential pkg-config \
  iptables-persistent unattended-upgrades
```

`ffmpeg` normalises browser audio to wav; `libsndfile1` is required by
soundfile/librosa. **No Java is needed** — the LanguageTool dependency is gone.

Ubuntu 24.04 enforces PEP 668 (no `pip install` into the system Python), which is
why every step below goes through a virtualenv.

## 4. Swap

The free tier has no swap, and inference peaks well above idle memory (measured:
~740 MB loaded, ~1.3 GB peak). At 8 GB this is cheap insurance.

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. Service user and virtualenv

Never run the app as `ubuntu` or `root`.

```bash
sudo useradd --system --create-home --home-dir /opt/speaksure --shell /usr/sbin/nologin speaksure
sudo -u speaksure git clone <your-repo-url> /opt/speaksure/app
sudo -u speaksure python3.12 -m venv /opt/speaksure/venv
sudo -u speaksure /opt/speaksure/venv/bin/pip install --upgrade pip wheel
sudo -u speaksure /opt/speaksure/venv/bin/pip install -r /opt/speaksure/app/server/requirements.txt
```

This takes ~10 minutes and downloads roughly 2 GB of wheels. If `torch` or
`tensorflow` fails here, you are on the wrong Ubuntu version or a non-ARM shape.

## 6. Secrets

Kept outside the repo, readable only by the service user.

```bash
sudo tee /etc/speaksure.env >/dev/null <<'ENVEOF'
APP_ENV=production
SECRET_KEY=<python3 -c 'import secrets; print(secrets.token_hex(32))'>
MONGO_URI=<your-atlas-uri>
ASSEMBLYAI_API_KEY=<key>
GEMINI_API_KEY=<key>
CORS_ORIGINS=
HF_HOME=/opt/speaksure/hf-cache
# 1 OCPU: keep torch single-threaded and the thread pool small.
TORCH_NUM_THREADS=1
THREAD_POOL_SIZE=4
ENVEOF
sudo chown root:speaksure /etc/speaksure.env
sudo chmod 640 /etc/speaksure.env
```

`CORS_ORIGINS` stays **empty**: nginx serves the SPA and the API on one origin,
so no CORS headers are needed. The app refuses to start in production with a
default `SECRET_KEY` or a `*` CORS origin.

Use **MongoDB Atlas M0** (free, 512 MB) rather than a local `mongod`, which would
cost ~1 GB of RAM. Add this instance's public IP to the Atlas network access list.
512 MB is plenty: `/api/predict` stores only transcripts and metrics, not audio.

## 7. Pre-warm the model cache

Otherwise the first real request stalls for minutes downloading 360 MB.

```bash
sudo -u speaksure mkdir -p /opt/speaksure/hf-cache
sudo -u speaksure HF_HOME=/opt/speaksure/hf-cache /opt/speaksure/venv/bin/python -c \
  "from transformers import Wav2Vec2Processor, Wav2Vec2Model; \
   Wav2Vec2Processor.from_pretrained('facebook/wav2vec2-base-960h'); \
   Wav2Vec2Model.from_pretrained('facebook/wav2vec2-base-960h')"
```

## 8. systemd

```bash
sudo cp /opt/speaksure/app/deploy/speaksure.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now speaksure
journalctl -u speaksure -f      # watch the models load
curl -s localhost:5000/api/health
```

Two workers at ~1.3-2 GB each against 8 GB leaves comfortable headroom, and lets
one interview proceed while another waits on AssemblyAI. If you do see memory
pressure, drop to `--workers 1` in the unit file. `--timeout 300` matters because
`/api/predict` waits on two external APIs.

## 9. Frontend

Build on your laptop — this skips installing Node and ~400 MB of `node_modules`
on the instance.

```bash
# locally
cd client && npm run build
rsync -av dist/ ubuntu@<ip>:/tmp/dist/

# on the server
sudo mkdir -p /var/www/speaksure
sudo rsync -av --delete /tmp/dist/ /var/www/speaksure/
sudo chown -R www-data:www-data /var/www/speaksure
```

`.env.production` sets `VITE_API_BASE=/api`, so the bundle uses relative URLs.

## 10. nginx

```bash
sudo cp /opt/speaksure/app/deploy/nginx-speaksure.conf /etc/nginx/sites-available/speaksure
sudo sed -i 's/your-domain.com/<your actual domain>/' /etc/nginx/sites-available/speaksure
sudo ln -s /etc/nginx/sites-available/speaksure /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 11. TLS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

**This is mandatory, not optional**: browsers only grant microphone access on
secure origins, so the interview page will not work over plain HTTP.

## 12. Day to day

```bash
/opt/speaksure/app/deploy/deploy.sh     # pull, install, restart, health-check
journalctl -u speaksure -n 100 --no-pager
sudo systemctl restart speaksure
```

Also worth setting up: `sudo apt install unattended-upgrades`, and capping journal
size via `SystemMaxUse=500M` in `/etc/systemd/journald.conf`.

---

## Local development

```bash
# server
cd server
cp .env.example .env          # fill in the keys, leave APP_ENV=development
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run.py                 # http://127.0.0.1:5000, docs at /docs

# client
cd client && npm install && npm run dev
```

In development the Vite dev server runs cross-origin, so set
`CORS_ORIGINS=http://localhost:6173` in `server/.env`.
