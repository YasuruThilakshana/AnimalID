/** Demo visual-matching heuristics for the Photo Scanner.
 *  No real image recognition runs here — scores combine a deterministic
 *  pseudo-visual signal from the uploaded bytes with genuine text overlap
 *  (species, colors, markings, location) supplied by the finder.
 */

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "with", "has", "have", "is", "it", "its",
  "very", "quite", "some", "small", "large", "big", "little", "old", "young",
]);

export function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Deterministic pseudo-visual score (30–95) from image bytes + pet id. */
export function visualScore(dataUrl, petId) {
  const sample = `${dataUrl.length}:${String(dataUrl).slice(0, 400)}:${petId}`;
  return 30 + Math.round((fnv1a(sample) % 1000) / 10 / 1.54);
}

/**
 * Score every pet against a scan. Returns [{ pet, score, band, reasons }].
 * @param {string} dataUrl uploaded photo (data URL)
 * @param {Array} pets registered pets
 * @param {{species?: string, markings?: string, location?: string}} hints finder-supplied hints
 */
export function scorePets(dataUrl, pets, hints = {}) {
  const markTokens = tokens(hints.markings);
  const locNeedle = String(hints.location || "").toLowerCase().trim();

  return pets
    .map((pet) => {
      const visual = visualScore(dataUrl, pet.id);
      const reasons = [];
      let bonus = 0;

      if (hints.species && hints.species !== "Unknown" && pet.species === hints.species) {
        bonus += 9;
        reasons.push(`Species match (${pet.species})`);
      }

      if (markTokens.length) {
        const hay = tokens(`${pet.color} ${pet.marks} ${pet.breed} ${pet.name}`);
        const hits = markTokens.filter((t) => hay.some((h) => h === t || h.startsWith(t) || t.startsWith(h)));
        if (hits.length) {
          bonus += Math.min(14, hits.length * 5);
          reasons.push(`Markings overlap: ${[...new Set(hits)].slice(0, 3).join(", ")}`);
        }
      }

      const colorWords = tokens(pet.color);
      if (markTokens.length && colorWords.some((c) => markTokens.includes(c))) {
        bonus += 4;
        reasons.push(`Coat color match (${pet.color})`);
      }

      if (locNeedle && pet.location.toLowerCase().includes(locNeedle)) {
        bonus += 6;
        reasons.push(`Same area (${pet.location})`);
      }

      if (pet.status === "lost") {
        bonus += 3;
        reasons.push("Actively reported lost");
      }

      const photoCount = Object.values(pet.photos || {}).filter(Boolean).length;
      if (photoCount >= 3) {
        bonus += 2;
        reasons.push(`${photoCount}-angle reference set`);
      }

      const score = Math.max(5, Math.min(97, Math.round(visual * 0.72 + 18 + bonus)));
      const band = score >= 80 ? "High" : score >= 60 ? "Medium" : "Low";
      if (!reasons.length) reasons.push("General visual similarity");
      return { pet, score, band, reasons: reasons.slice(0, 4) };
    })
    .sort((a, b) => b.score - a.score);
}

/** Read a File as a downscaled JPEG data URL (max 640px). */
export function fileToDataUrl(file, max = 640) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    img.src = url;
  });
}
