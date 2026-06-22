# GPU headless-Chrome render service. Run on a host with an NVIDIA GPU exposed
# to the container (Cloud Run GPU, Fly GPU, Runpod, etc.). The base image must
# carry NVIDIA userspace libs at runtime — see README for per-host notes.
#
# Chromium is installed from Debian. GPU flags are passed via CHROME_FLAGS env
# (see render.mjs); tune per host's driver (vulkan vs gl).

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Chromium + the fonts/libs headless Chrome needs to render real pages.
# ffmpeg transcodes the VP9/WebM the headless Chromium produces (it has no
# proprietary H.264 encoder) into H.264/MP4 — the only video format X accepts.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ffmpeg \
      fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
      libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 \
      libegl1 libgles2 libgl1 libglvnd0 libvulkan1 vulkan-tools \
      libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libxshmfence1 \
      xvfb \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
# Cloud Run injects the NVIDIA driver userspace at /usr/local/nvidia at runtime.
# Put its libs on the loader path and its bins (nvidia-smi) on PATH.
ENV PATH=/usr/local/nvidia/bin:${PATH}
ENV LD_LIBRARY_PATH=/usr/local/nvidia/lib64:/usr/local/nvidia/lib
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV NVIDIA_VISIBLE_DEVICES=all
# THE GPU FIX. Cloud Run injects NVIDIA's GL/Vulkan libs (nvidia-smi works) but NOT
# a Vulkan ICD manifest, so the Vulkan loader finds no driver. Register one pointing
# at the injected NVIDIA driver; with it, vulkaninfo enumerates the L4 and Chrome's
# ANGLE-Vulkan backend renders WebGL on the real GPU.
#   - ANGLE's *GL* backend is a dead end here: it requires an X display, and the only
#     X server available (Xvfb) is Mesa/llvmpipe (software) — so GL → blank hero.
#   - ANGLE's *Vulkan* backend talks to this ICD directly (no GLX), reaching the L4.
#     It still wants a VK_KHR_xcb_surface, so Xvfb stays ON (USE_XVFB=true) purely to
#     satisfy that window-system extension; rendering itself is GPU/offscreen.
RUN mkdir -p /usr/share/vulkan/icd.d \
    && printf '{"file_format_version":"1.0.0","ICD":{"library_path":"/usr/local/nvidia/lib64/libGLX_nvidia.so.0","api_version":"1.3.0"}}\n' \
       > /usr/share/vulkan/icd.d/nvidia_icd.json
# NVIDIA L4 flags: drive WebGL through ANGLE's Vulkan backend on the real GPU.
ENV CHROME_FLAGS=--use-gl=angle,--use-angle=vulkan,--enable-features=Vulkan,--enable-webgl,--ignore-gpu-blocklist,--disable-gpu-sandbox,--disable-dev-shm-usage,--no-sandbox
ENV MAX_CONCURRENCY=1
ENV EXIT_AFTER_RENDER=false
ENV USE_XVFB=true
ENV PORT=8080

WORKDIR /app
COPY package.json ./
COPY server.mjs render.mjs scene.mjs recipe.mjs ./
COPY assets/ ./assets/

EXPOSE 8080
CMD ["node", "server.mjs"]
