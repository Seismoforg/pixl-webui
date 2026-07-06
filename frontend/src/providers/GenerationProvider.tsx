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

import { useActivity } from "@/providers/ActivityProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { clearJob, saveJob } from "@/lib/jobPersistence";
import { useJobRehydrate } from "@/lib/jobHooks";
import { useJobTracker } from "@/lib/ws";
import type {
  GalleryImage,
  GenerationProgress,
  LoraRef,
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
  // Gallery metadata when the reference came from the gallery (else null); kept in
  // context so it survives navigation alongside referenceImage.
  referenceMeta: GalleryImage | null;
  referenceMode: ReferenceMode;
  strength: number;
  ipAdapterScale: number;
  loras: LoraRef[];
  setLoras: (v: LoraRef[]) => void;
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
  setReferenceMeta: (v: GalleryImage | null) => void;
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

export const useGeneration = () => {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGeneration must be used within GenerationProvider");
  return ctx;
}

interface GenerationProviderProps {
  models: ModelEntry[];
  onGenerated: () => void;
  children: ReactNode;
}

export const GenerationProvider = ({ models, onGenerated, children }: GenerationProviderProps) => {
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
  const [referenceMeta, setReferenceMeta] = useState<GalleryImage | null>(null);
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("img2img");
  const [strength, setStrength] = useState(0.6);
  const [ipAdapterScale, setIpAdapterScale] = useState(0.6);
  const [loras, setLoras] = useState<LoraRef[]>([]);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Preferred default model from Settings (applied only when downloaded); gated so
  // the initial model pick waits for it rather than racing to the first model.
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

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

  // Load the preferred default model from Settings (best-effort).
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setDefaultModel(s.default_model))
      .catch(() => setDefaultModel(null))
      .finally(() => setSettingsLoaded(true));
  }, []);

  // Select the initial model — the Settings default when downloaded, else the first
  // downloaded — and apply its defaults. Waits for Settings so the default wins.
  useEffect(() => {
    if (!settingsLoaded || downloaded.length === 0) return;
    if (downloaded.some((m) => m.slug === slug)) return;
    const target = downloaded.find((m) => m.slug === defaultModel) ?? downloaded[0];
    setSlug(target.slug);
    setSteps(target.defaults.steps);
    setGuidance(target.defaults.guidance_scale);
    setWidth(target.defaults.width);
    setHeight(target.defaults.height);
  }, [downloaded, slug, defaultModel, settingsLoaded]);

  // Track the running job over the WebSocket, with a REST poll fallback while the
  // socket is down (see useJobTracker). The handler fills the grid live as batch
  // images complete and clears the job on done/error.
  useJobTracker<GenerationProgress>(
    jobId,
    "generation",
    (id) => api.getGenerationProgress(id),
    (p) => {
      setProgress(p);
      setImages(p.image_ids.map((id) => api.imageFileUrl(id)));
      if (p.status === "done") {
        setJobId(null);
        clearJob("generation");
        onGenerated();
      } else if (p.status === "error") {
        setError(p.error ?? t("common.error"));
        setJobId(null);
        clearJob("generation");
      }
    },
    (message) => {
      setError(message);
      setJobId(null);
      clearJob("generation");
    },
    POLL_MS,
  );

  // Rehydrate a job that was still running when the page reloaded: the backend job
  // keeps going, so re-attach the tracker (which republishes progress + the bubble)
  // if it is still running; otherwise drop the stale id.
  useJobRehydrate("generation", (id) => api.getGenerationProgress(id), setJobId);

  // Publish the running job to the shared activity store for the off-route bubble.
  const { set: setActivity } = useActivity();
  useEffect(() => {
    if (!running) {
      setActivity("generation", null);
      return;
    }
    let detail: string;
    let percent: number | null = null;
    if (!progress) {
      detail = t("generate.running");
    } else if (progress.phase === "loading") {
      detail = t("generate.phaseLoading");
    } else if (progress.phase === "finalizing") {
      detail = t("generate.phaseFinalizing");
    } else {
      detail = t("generate.step", { current: progress.current_step, total: progress.total_steps });
      percent = progress.total_steps > 0 ? (progress.current_step / progress.total_steps) * 100 : null;
    }
    setActivity("generation", {
      id: "generation",
      title: t("activity.generation"),
      route: "/generate",
      status: "running",
      detail,
      percent,
    });
  }, [running, progress, setActivity, t]);

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
        loras,
      });
      setJobId(job_id);
      saveJob("generation", job_id);
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
    loras,
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

  const value = useMemo<GenerationContextValue>(
    () => ({
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
      referenceMeta,
      referenceMode,
      strength,
      ipAdapterScale,
      loras,
      setLoras,
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
      setReferenceMeta,
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
    }),
    [
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
      referenceMeta,
      referenceMode,
      strength,
      ipAdapterScale,
      loras,
      changeModel,
      progress,
      images,
      error,
      running,
      generate,
      applyPrefill,
    ],
  );

  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}
