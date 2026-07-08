"use client";

// Shared sampler bootstrap: fetch the list once and hand the backend default to the
// caller so an empty selection starts on it. Used by the generation, compare,
// reframe and inpaint providers (previously four copies of the same effect).

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Sampler } from "@/types";

export const useSamplers = (onDefault: (id: string) => void): Sampler[] => {
  const [samplers, setSamplers] = useState<Sampler[]>([]);
  const cb = useRef(onDefault);
  cb.current = onDefault;
  useEffect(() => {
    api
      .getSamplers()
      .then((list) => {
        setSamplers(list.samplers);
        cb.current(list.default);
      })
      .catch(() => setSamplers([]));
  }, []);
  return samplers;
};
