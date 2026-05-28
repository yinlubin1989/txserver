"use client";

import { useState } from "react";

interface Photo {
  name: string;
  url: string;
}

export default function PhotoGrid({ photos }: { photos: Photo[] }) {
  const [selected, setSelected] = useState<Photo | null>(null);

  return (
    <>
      <div className="columns-2 gap-3 sm:columns-3 sm:gap-4 lg:columns-4">
        {photos.map((photo, i) => (
          <button
            key={photo.name}
            onClick={() => setSelected(photo)}
            className="group mb-3 block w-full overflow-hidden sm:mb-4"
          >
            <img
              src={photo.url}
              alt={`Photo ${i + 1}`}
              loading="lazy"
              className="w-full grayscale transition-all duration-500 group-hover:grayscale-0"
            />
          </button>
        ))}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setSelected(null)}
        >
          <button
            className="absolute right-4 top-4 text-sm tracking-[0.2em] text-white/60 transition-colors hover:text-white"
            onClick={() => setSelected(null)}
          >
            CLOSE
          </button>
          <img
            src={selected.url}
            alt="Enlarged photo"
            className="max-h-[90vh] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
