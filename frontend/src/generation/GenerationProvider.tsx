"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type {
  GalleryImage,
  GenerationProgress,
  ModelEntry,
  ReferenceMode,
  Sampler,
} from "@/types";

/**
 * Holds the whole generation lifecycle (form values + running job) in a context
 * that stays mounted for the app's lifetime. Because the polling loop lives here
 * and not in the (unmountable) GenerationPanel, a generation keeps running when
 * the user switches tabs, and the last result + settings survive the round trip.
 */
interface GenerationContextValue {
  // form
  slug: string;
  prompt: string;
  negative: string;
  steps: number;
  guidance: number;
  width: number;
  height: number;
  seed: string;
  sampler: string;
  samplers: Sampler[];
  preview: boolean;
  batch: number;
  referenceImage: string | null;
  referenceMode: ReferenceMode;
  strength: number;
  ipAdapterScale: number;
  setPrompt: (v: string) => void;
  setNegative: (v: string) => void;
  setSteps: (v: number) => void;
  setGuidance: (v: number) => void;
  setWidth: (v: number) => void;
  setHeight: (v: number) => void;
  setSeed: (v: string) => void;
  setSampler: (v: string) => void;
  setPreview: (v: boolean) => void;
  setBatch: (v: number) => void;
  setReferenceImage: (v: string | null) => void;
  setReferenceMode: (v: ReferenceMode) => void;
  setStrength: (v: number) => void;
  setIpAdapterScale: (v: number) => void;
  changeModel: (slug: string) => void;
  // job
  progress: GenerationProgress | null;
  images: string[];
  error: string | null;
  running: boolean;
  generate: () => Promise<void>;
  applyPrefill: (image: GalleryImage) => void;
}

const GenerationContext = createContext<GenerationContextValue | null>(null);

const POLL_MS = 500;

export function useGeneration() {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGeneration must be used within GenerationProvider");
  return ctx;
}

interface GenerationProviderProps {
  models: ModelEntry[];
  onGenerated: () => void;
  children: ReactNode;
}

export function GenerationProvider({ models, onGenerated, children }: GenerationProviderProps) {
  const t = useTranslations();
  const downloaded = useMemo(() => models.filter((m) => m.downloaded), [models]);

  const [slug, setSlug] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [steps, setSteps] = useState(30);
  const [guidance, setGuidance] = useState(7);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [seed, setSeed] = useState("");
  const [sampler, setSampler] = useState("");
  const [samplers, setSamplers] = useState<Sampler[]>([]);
  const [preview, setPreview] = useState(false);
  const [batch, setBatch] = useState(1);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("img2img");
  const [strength, setStrength] = useState(0.6);
  const [ipAdapterScale, setIpAdapterScale] = useState(0.6);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const running = jobId !== null;

  // Load the sampler list once and preselect the recommended default.
  useEffect(() => {
    api
      .getSamplers()
      .then((list) => {
        setSamplers(list.samplers);
        setSampler((current) => current || list.default);
      })
      .catch(() => setSamplers([]));
  }, []);

  // Select the first available model and apply its defaults.
  useEffect(() => {
    if (downloaded.length === 0) return;
    if (downloaded.some((m) => m.slug === slug)) return;
    const first = downloaded[0];
    setSlug(first.slug);
    setSteps(first.defaults.steps);
    setGuidance(first.defaults.guidance_scale);
    setWidth(first.defaults.width);
    setHeight(first.defaults.height);
  }, [downloaded, slug]);

  // Poll the running job for step progress and completion.
  useEffect(() => {
    if (!jobId) return undefined;
    const id = setInterval(async () => {
      try {
        const p = await api.getGenerationProgress(jobId);
        setProgress(p);
        // Fill the grid live as batch images complete.
        setImages(p.image_ids.map((id) => api.imageFileUrl(id)));
        if (p.status === "done") {
          setJobId(null);
          onGenerated();
        } else if (p.status === "error") {
          setError(p.error ?? t("common.error"));
          setJobId(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setJobId(null);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [jobId, onGenerated, t]);

  const changeModel = useCallback(
    (nextSlug: string) => {
      setSlug(nextSlug);
      const model = downloaded.find((m) => m.slug === nextSlug);
      if (model) {
        setSteps(model.defaults.steps);
        setGuidance(model.defaults.guidance_scale);
        setWidth(model.defaults.width);
        setHeight(model.defaults.height);
      }
    },
    [downloaded],
  );

  const generate = useCallback(async () => {
    setError(null);
    setImages([]);
    setProgress(null);
    try {
      const { job_id } = await api.generate({
        slug,
        prompt,
        negative_prompt: negative || null,
        steps,
        guidance_scale: guidance,
        width,
        height,
        seed: seed.trim() === "" ? null : Number(seed),
        sampler,
        preview,
        batch,
        reference_image: referenceImage,
        reference_mode: referenceMode,
        strength,
        ip_adapter_scale: ipAdapterScale,
      });
      setJobId(job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [
    slug,
    prompt,
    negative,
    steps,
    guidance,
    width,
    height,
    seed,
    sampler,
    preview,
    batch,
    referenceImage,
    referenceMode,
    strength,
    ipAdapterScale,
  ]);

  const applyPrefill = useCallback(
    (img: GalleryImage) => {
      setPrompt(img.prompt);
      setNegative(img.negative_prompt ?? "");
      setSteps(img.steps);
      setGuidance(img.guidance_scale);
      setWidth(img.width);
      setHeight(img.height);
      setSeed(String(img.seed));
      if (samplers.some((s) => s.id === img.sampler)) {
        setSampler(img.sampler);
      }
      if (downloaded.some((m) => m.slug === img.model_slug)) {
        setSlug(img.model_slug);
      }
    },
    [downloaded, samplers],
  );

  const value: GenerationContextValue = {
    slug,
    prompt,
    negative,
    steps,
    guidance,
    width,
    height,
    seed,
    sampler,
    samplers,
    preview,
    batch,
    referenceImage,
    referenceMode,
    strength,
    ipAdapterScale,
    setPrompt,
    setNegative,
    setSteps,
    setGuidance,
    setWidth,
    setHeight,
    setSeed,
    setSampler,
    setPreview,
    setBatch,
    setReferenceImage,
    setReferenceMode,
    setStrength,
    setIpAdapterScale,
    changeModel,
    progress,
    images,
    error,
    running,
    generate,
    applyPrefill,
  };

  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}
