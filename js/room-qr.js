/** QR codes for room join links — one unique code per room URL. */

import QRCode from "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm";

/**
 * @param {HTMLCanvasElement | HTMLImageElement} target
 * @param {string} url
 * @param {{ size?: number }} [opts]
 */
export async function renderJoinQr(target, url, { size = 200 } = {}) {
  if (!target || !url) return;

  const options = {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0a1628", light: "#ffffff" },
  };

  if (target instanceof HTMLCanvasElement) {
    await QRCode.toCanvas(target, url, options);
    return;
  }

  if (target instanceof HTMLImageElement) {
    target.src = await QRCode.toDataURL(url, options);
  }
}
