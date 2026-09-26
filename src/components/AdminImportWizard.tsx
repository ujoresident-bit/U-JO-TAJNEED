import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  FileJson,
  FileText,
  AlertCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  Check,
  Sparkles,
  Filter,
  Eye,
  RefreshCw,
  Search,
  HelpCircle,
  ShieldAlert
} from 'lucide-react';
import { ImportPreviewResult, Question, OptionKey } from '../types';
import { previewImportBatch, executeImportBatch, parseTextQuestions } from '../services/questionBankService';

interface AdminImportWizardProps {
  adminUserId: string;
  onImportCompleted: () => void;
  onCancel?: () => void;
}

export const AdminImportWizard: React.FC<AdminImportWizardProps> = ({
  adminUserId,
  onImportCompleted,
  onCancel
}) => {
  // 5-step workflow:
  // 1: Configuration (Year & Bank)
  // 2: Upload JSON
  // 3: Complete Medical Explanations (AI Background Processing)
  // 4: Review / Verification
  // 5: Import & Commit
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Selection
  const [selectedBank, setSelectedBank] = useState<string>('human_medicine');
  // QBANK BASIC is its own selectable import target in the UI, but its
  // questions are stored under bank_id='human_medicine' (so they inherit
  // the same Human Medicine subscription/access — QBANK BASIC is reached
  // as a card inside the Human Medicine hub, not a separately paid bank).
  // This flag just changes which fields the wizard shows.
  const [importTarget, setImportTarget] = useState<'human_medicine' | 'dentistry' | 'qbank_basic'>('human_medicine');
  const [selectedYear, setSelectedYear] = useState<number | string>(2025);
  // Human Medicine "Past Years" now requires choosing TAJNEED or MADANI
  // FIRST (mandatory, no default), then manually typing the year number —
  // the two combine into the actual stored category label (e.g. "TAJNEED
  // 2023"), which appears as its own distinct filter chip on the
  // student-facing Past Years page automatically.
  const [examCategory, setExamCategory] = useState<'TAJNEED' | 'MADANI' | ''>('');
  const [qbankBasicMajor, setQbankBasicMajor] = useState<string>('');
  // Bulk "Most Common" tagging — applies to the whole batch, for Human
  // Medicine/Dentistry imports, alongside their normal year/category.
  const [markAsMostCommon, setMarkAsMostCommon] = useState<boolean>(false);
  const [manualYearInput, setManualYearInput] = useState<string>('2025');

  // Keep the actual stored value in sync: Human Medicine (Past Years)
  // combines the mandatory category with the manually typed year;
  // Dentistry uses the manual year as a number; QBANK BASIC doesn't use
  // "year" as a meaningful concept at all (its own filter is Major-only),
  // so it gets a fixed neutral label instead.
  useEffect(() => {
    if (importTarget === 'human_medicine') {
      if (examCategory && manualYearInput.trim()) {
        setSelectedYear(`${examCategory} ${manualYearInput.trim()}`);
      }
    } else if (importTarget === 'qbank_basic') {
      setSelectedYear('QBANK_BASIC');
    } else {
      const n = Number(manualYearInput);
      if (manualYearInput.trim() && !isNaN(n)) {
        setSelectedYear(n);
      }
    }
  }, [importTarget, examCategory, manualYearInput]);

  // Step 2: Textarea & File
  const [pastedText, setPastedText] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live count of detected questions in textarea
  const detectedCount = parseTextQuestions(pastedText).length;

  // Parsed Preview Result
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null);

  // Step 3: AI Explanation Processing state
  const [aiProcessing, setAiProcessing] = useState<boolean>(false);
  const [aiProcessedCount, setAiProcessedCount] = useState<number>(0);
  const [aiTotalCount, setAiTotalCount] = useState<number>(0);
  const [aiProcessingComplete, setAiProcessingComplete] = useState<boolean>(false);
  const [processedQuestions, setProcessedQuestions] = useState<Question[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);

  // Step 4: Review / Verification Filters
  const [reviewFilter, setReviewFilter] = useState<'ALL' | 'NEEDS_REVIEW'>('NEEDS_REVIEW');
  const [reviewSearch, setReviewSearch] = useState<string>('');
  const [selectedReviewQuestion, setSelectedReviewQuestion] = useState<Question | null>(null);

  // Step 5: Import execution
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'update' | 'cancel'>('skip');
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<{ count: number; batchId: string } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setFileError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setPastedText(text);
    };
    reader.onerror = () => {
      setFileError('Failed to read uploaded file.');
    };
    reader.readAsText(file);
  };

  const handleTextImportNext = () => {
    const textContent = pastedText.trim();
    if (!textContent) {
      setFileError('Please paste your questions text into the area above.');
      return;
    }

    try {
      setFileError(null);
      const preview = previewImportBatch(
        selectedBank,
        selectedYear,
        textContent,
        fileName || `${selectedYear}_pasted_batch.txt`,
        importTarget === 'qbank_basic' ? qbankBasicMajor : undefined,
        markAsMostCommon
      );
      setPreviewResult(preview);
      setProcessedQuestions(preview.validQuestions);
      if (preview.duplicateQuestions.length > 0) {
        setDuplicateAction('skip');
      }
      setStep(3); // Go to Step 3: Complete Medical Explanations
      startAiExplanationProcessing(preview.validQuestions);
    } catch (err: any) {
      setFileError(err.message || 'Failed to parse questions text content.');
    }
  };

  // Step 3: Run Chunked AI Explanation Completion
  const startAiExplanationProcessing = async (questionsToProcess: Question[]) => {
    if (questionsToProcess.length === 0) {
      setAiProcessingComplete(true);
      return;
    }

    setAiProcessing(true);
    setAiProcessingComplete(false);
    setAiError(null);
    setAiProcessedCount(0);
    setAiTotalCount(questionsToProcess.length);

    const updatedList = [...questionsToProcess];
    const CHUNK_SIZE = 15; // Process in chunks of 15 questions per API call

    try {
      for (let i = 0; i < updatedList.length; i += CHUNK_SIZE) {
        const chunk = updatedList.slice(i, i + CHUNK_SIZE);

        const response = await fetch('/api/ai/complete-explanations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questions: chunk })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || `Server returned HTTP ${response.status}`);
        }

        const results = data.results || [];
        if (!Array.isArray(results) || results.length === 0) {
          throw new Error('Server returned empty or invalid results from AI processing.');
        }

        // Map results back onto updatedList
        results.forEach((resItem: any) => {
          const idx = updatedList.findIndex((q) => q.id === resItem.id);
          if (idx !== -1) {
            const newMajor = (resItem.major && resItem.major !== 'Unassigned') ? resItem.major : updatedList[idx].major;
            const newTopic = (resItem.topic && resItem.topic !== 'Unassigned Topic') ? resItem.topic : updatedList[idx].topic;
            const newSubtopic = resItem.subtopic || updatedList[idx].subtopic || '';
            const isUnclassified = !newMajor || newMajor === 'Unassigned' || !newTopic || newTopic === 'Unassigned Topic';
            const needsRev = typeof resItem.needsReview === 'boolean' ? resItem.needsReview : isUnclassified;

            updatedList[idx] = {
              ...updatedList[idx],
              major: newMajor,
              topic: newTopic,
              subtopic: newSubtopic,
              optionExplanations: resItem.optionExplanations || updatedList[idx].optionExplanations,
              evidenceSources: resItem.evidenceSources || updatedList[idx].evidenceSources,
              groundingQueries: resItem.groundingQueries || updatedList[idx].groundingQueries,
              needsReview: needsRev,
              reviewNote: resItem.reviewNote !== undefined ? resItem.reviewNote : updatedList[idx].reviewNote,
              classificationStatus: needsRev ? 'NEEDS_REVIEW' : 'CLASSIFIED'
            };
          }
        });

        const newProcessed = Math.min(i + CHUNK_SIZE, updatedList.length);
        setAiProcessedCount(newProcessed);
        setProcessedQuestions([...updatedList]);
      }

      setAiProcessingComplete(true);
    } catch (err: any) {
      console.error("AI Explanation Processing Error:", err);
      setAiError(err.message || "An error occurred during AI processing. Please retry.");
      setAiProcessingComplete(false);
    } finally {
      setAiProcessing(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!previewResult) return;
    setIsConfirming(true);
    setImportError(null);

    try {
      // Create final import preview with completed AI questions
      const finalPreview: ImportPreviewResult = {
        ...previewResult,
        validQuestions: processedQuestions,
        needsReviewCount: processedQuestions.filter((q) => q.needsReview || q.classificationStatus === 'NEEDS_REVIEW').length,
        explanationsCompletedCount: processedQuestions.filter((q) => q.optionExplanations && Object.keys(q.optionExplanations).length > 0).length
      };

      const summary = await executeImportBatch(finalPreview, duplicateAction, adminUserId);
      setImportSummary({ count: summary.importedCount, batchId: summary.batchId });
      setStep(5);
      onImportCompleted();
    } catch (err: any) {
      setImportError(err.message || 'Error occurred during database insertion.');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setPastedText('');
    setFileName('');
    setFileError(null);
    setPreviewResult(null);
    setProcessedQuestions([]);
    setAiProcessedCount(0);
    setAiTotalCount(0);
    setAiProcessingComplete(false);
    setImportSummary(null);
  };

  const needsReviewQuestions = processedQuestions.filter(
    (q) => q.needsReview || q.classificationStatus === 'NEEDS_REVIEW'
  );

  const completedExplanationsCount = processedQuestions.filter(
    (q) => q.optionExplanations && Object.keys(q.optionExplanations).length > 0
  ).length;

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6 shadow-xl">
      {/* Step Indicator Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Upload className="w-5 h-5 text-cyan-400" />
            <span>Question Bank Import Workflow</span>
          </h2>
          <p className="text-xs text-slate-400">
            Year-tagged import pipeline with medical accuracy verification & AI explanation completion
          </p>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none text-[11px] font-semibold">
          {[
            { num: 1, label: 'Configuration' },
            { num: 2, label: 'Paste Questions' },
            { num: 3, label: 'AI Explanations' },
            { num: 4, label: 'Review' },
            { num: 5, label: 'Import' }
          ].map((s) => (
            <div
              key={s.num}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border shrink-0 ${
                step === s.num
                  ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400 shadow-md shadow-cyan-500/20'
                  : step > s.num
                  ? 'bg-slate-800 text-emerald-400 border-emerald-500/30'
                  : 'bg-slate-950 text-slate-500 border-slate-800'
              }`}
            >
              <span>Step {s.num}: {s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* STEP 1: Configuration */}
      {step === 1 && (
        <div className="space-y-5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="font-bold text-slate-200">Target Question Bank</label>
              <select
                value={importTarget}
                onChange={(e) => {
                  const target = e.target.value as 'human_medicine' | 'dentistry' | 'qbank_basic';
                  setImportTarget(target);
                  // QBANK BASIC questions are stored under human_medicine
                  // (same subscription/access), so the actual bank_id sent
                  // to the server is always human_medicine here.
                  setSelectedBank(target === 'qbank_basic' ? 'human_medicine' : target);
                  if (target === 'qbank_basic') {
                    setExamCategory('');
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="human_medicine">Human Medicine — Past Years</option>
                <option value="dentistry">Dentistry</option>
                <option value="qbank_basic">QBANK BASIC</option>
              </select>
              <p className="text-[11px] text-slate-500">
                Determines the destination bank collection for this batch.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-200">
                {importTarget === 'qbank_basic' ? 'Content Type' : 'Exam Year Batch'}
              </label>

              {importTarget === 'human_medicine' ? (
                <>
                  {/* Mandatory category choice — no default, must pick one */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setExamCategory('TAJNEED')}
                      className={`flex-1 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                        examCategory === 'TAJNEED'
                          ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      TAJNEED
                    </button>
                    <button
                      type="button"
                      onClick={() => setExamCategory('MADANI')}
                      className={`flex-1 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                        examCategory === 'MADANI'
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      MADANI
                    </button>
                  </div>
                  {!examCategory && (
                    <p className="text-[11px] text-rose-400">Required: choose TAJNEED or MADANI before entering the year.</p>
                  )}

                  {/* Manual year entry, only meaningful once a category is chosen */}
                  <input
                    type="number"
                    value={manualYearInput}
                    onChange={(e) => setManualYearInput(e.target.value)}
                    disabled={!examCategory}
                    placeholder="e.g. 2023"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500 disabled:opacity-40"
                  />
                </>
              ) : importTarget === 'qbank_basic' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {['Pharmacology', 'Microbiology', 'Immunology', 'Anatomy'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setQbankBasicMajor(m)}
                        className={`px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                          qbankBasicMajor === m
                            ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-600'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {!qbankBasicMajor && (
                    <p className="text-[11px] text-rose-400">Required: choose one subject for this batch.</p>
                  )}
                  <p className="text-[11px] text-slate-500">
                    This subject will be applied authoritatively to every question in this file, overriding any Major found in the pasted text.
                  </p>
                </>
              ) : (
                <input
                  type="number"
                  value={manualYearInput}
                  onChange={(e) => setManualYearInput(e.target.value)}
                  placeholder="e.g. 2023"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              )}

              <p className="text-[11px] text-slate-500">
                Applied authoritatively to every question in this uploaded file.
              </p>
            </div>

            {(importTarget === 'human_medicine' || importTarget === 'dentistry') && (
              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-amber-500/40 transition-colors">
                <input
                  type="checkbox"
                  checked={markAsMostCommon}
                  onChange={(e) => setMarkAsMostCommon(e.target.checked)}
                  className="w-4 h-4 accent-amber-500"
                />
                <span className="text-xs text-slate-300">
                  Also mark every question in this batch as <strong className="text-amber-400">Most Common</strong>
                </span>
              </label>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={() => setStep(2)}
              disabled={
                (importTarget === 'human_medicine' && !examCategory) ||
                (importTarget === 'qbank_basic' && !qbankBasicMajor)
              }
              className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold flex items-center gap-2 transition-all shadow-md shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>Next: Paste Questions</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Import Questions as Text */}
      {step === 2 && (
        <div className="space-y-5 text-xs">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-slate-400">Target Configuration: </span>
              <strong className="text-cyan-400">
                {importTarget === 'dentistry'
                  ? 'Dentistry'
                  : importTarget === 'qbank_basic'
                  ? `QBANK BASIC — ${qbankBasicMajor}`
                  : 'Human Medicine'}
                {importTarget !== 'qbank_basic' && ` (${selectedYear} Exam Batch)`}
              </strong>
            </div>
            <button
              onClick={() => setStep(1)}
              className="text-xs text-slate-400 underline hover:text-slate-200"
            >
              Change
            </button>
          </div>

          {/* Standardized Text Format Info Box */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-cyan-400" />
                <span>Standardized Questions Text Format</span>
              </span>
              <span className="text-slate-500 text-[10px]">
                Copy & paste 100+ questions directly into the area below
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 font-mono text-[11px] text-slate-300 leading-relaxed overflow-x-auto">
              Q. Question stem here<br />
              A. Option A text<br />
              B. Option B text<br />
              C. Option C text<br />
              D. Option D text<br />
              Answer: B<br />
              Explanation: Original explanation text
            </div>
          </div>

          {/* Textarea Input Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-200 text-xs flex items-center gap-2">
                <span>Paste Questions Batch</span>
                {detectedCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[11px] animate-pulse">
                    ✓ {detectedCount} Question{detectedCount === 1 ? '' : 's'} Detected
                  </span>
                )}
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".txt,.json"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-all"
                >
                  Load File (.txt / .json)
                </button>
                {pastedText.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setPastedText('');
                      setFileName('');
                      setFileError(null);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] font-medium border border-rose-500/30 transition-all"
                  >
                    Clear Text
                  </button>
                )}
              </div>
            </div>

            <textarea
              rows={12}
              value={pastedText}
              onChange={(e) => {
                setPastedText(e.target.value);
                setFileError(null);
              }}
              placeholder={`Paste your standardized batch of questions here...\n\nExample:\nQ. A patient presents with a metabolic derangement characterized by a wide anion gap metabolic acidosis...\nA. Respiratory alkalosis\nB. High anion gap metabolic acidosis\nC. Normal anion gap metabolic acidosis\nD. Respiratory acidosis\nAnswer: B\nExplanation: An elevated anion gap metabolic acidosis occurs due to addition of fixed acids...`}
              className="w-full p-4 rounded-2xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-600 font-mono text-xs focus:outline-none focus:border-cyan-500 leading-relaxed resize-y"
            />
          </div>

          {fileError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 font-medium flex items-center gap-2">
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{fileError}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            <button
              onClick={handleTextImportNext}
              disabled={!pastedText.trim()}
              className={`px-5 py-2.5 rounded-xl font-extrabold flex items-center gap-2 transition-all ${
                pastedText.trim()
                  ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20'
                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
            >
              <span>Next: AI Explanation Processing ({detectedCount})</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Complete Medical Explanations (AI Processing) */}
      {step === 3 && (
        <div className="space-y-6 text-xs">
          <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  <Sparkles className={`w-5 h-5 ${aiProcessing ? 'animate-spin' : ''}`} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Medical Explanation Completion Engine
                  </h3>
                  <p className="text-slate-400 text-[11px]">
                    Generating missing option explanations for incorrect choices & verifying medical accuracy against authoritative sources.
                  </p>
                </div>
              </div>

              {aiProcessing ? (
                <span className="px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold text-[11px] flex items-center gap-1.5 animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold text-[11px] flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Verified & Complete</span>
                </span>
              )}
            </div>

            {/* Continuous Progress Bar */}
            <div className="space-y-2 pt-2">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-slate-300">AI Medical Verification Progress</span>
                <span className="text-cyan-400 font-mono">
                  {aiProcessedCount} / {aiTotalCount} Questions ({aiTotalCount > 0 ? Math.round((aiProcessedCount / aiTotalCount) * 100) : 0}%)
                </span>
              </div>

              <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800 p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-300 shadow-md shadow-cyan-500/20"
                  style={{ width: `${aiTotalCount > 0 ? (aiProcessedCount / aiTotalCount) * 100 : 0}%` }}
                />
              </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-[11px] text-slate-400">
                {aiProcessing
                  ? `Analyzing question vignettes and generating clinical reasoning for incorrect options...`
                  : `Medical explanation processing complete. ${completedExplanationsCount} questions updated with option explanations.`}
              </p>

              {!aiProcessing && (
                <button
                  onClick={() => startAiExplanationProcessing(processedQuestions)}
                  className="px-3.5 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-bold flex items-center gap-1.5 transition-all shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{completedExplanationsCount > 0 ? 'Re-Generate All Explanations' : 'Generate All Explanations'}</span>
                </button>
              )}
            </div>
            </div>
          </div>

          {/* Key Medical Accuracy Directives Display */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-[11px] text-slate-400">
            <div className="font-bold text-slate-300 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-cyan-400" />
              <span>Medical Accuracy & Integrity Rules Applied</span>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 list-disc list-inside">
              <li>Original question stems, options, correct answers, and original explanations remain strictly preserved.</li>
              <li>Explanations generated only for incorrect choices to clarify clinical reasoning.</li>
              <li>Cross-checked against authoritative medical guidelines (WHO, CDC, NIH, NICE, AHA/ACC, USPSTF).</li>
              <li>Questions requiring expert verification are flagged with <code>needsReview</code> and a detailed <code>reviewNote</code>.</li>
            </ul>
          </div>

          {aiError && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-medium flex items-center justify-between">
              <span>{aiError}</span>
              <button
                onClick={() => startAiExplanationProcessing(processedQuestions)}
                className="px-3 py-1 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs"
              >
                Retry
              </button>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            <button
              onClick={() => setStep(4)}
              disabled={aiProcessing}
              className={`px-5 py-2.5 rounded-xl font-extrabold flex items-center gap-2 transition-all ${
                !aiProcessing
                  ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20'
                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
            >
              <span>Next: Review & Verification</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Review / Verification */}
      {step === 4 && previewResult && (
        <div className="space-y-5 text-xs">
          {/* Verification Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Total Questions</span>
              <div className="text-xl font-black text-slate-100">{processedQuestions.length}</div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Explanations Completed</span>
              <div className="text-xl font-black text-emerald-400">{completedExplanationsCount}</div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Needs Review</span>
              <div className={`text-xl font-black ${needsReviewQuestions.length > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                {needsReviewQuestions.length}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Exam Year</span>
              <div className="text-xl font-black text-cyan-400">{selectedYear}</div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setReviewFilter('NEEDS_REVIEW')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  reviewFilter === 'NEEDS_REVIEW'
                    ? 'bg-amber-500 text-slate-950 border-amber-400'
                    : 'bg-slate-900 text-slate-300 border-slate-800'
                }`}
              >
                Needs Review ({needsReviewQuestions.length})
              </button>
              <button
                onClick={() => setReviewFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  reviewFilter === 'ALL'
                    ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                    : 'bg-slate-900 text-slate-300 border-slate-800'
                }`}
              >
                All Questions ({processedQuestions.length})
              </button>
            </div>

            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={reviewSearch}
                onChange={(e) => setReviewSearch(e.target.value)}
                placeholder="Search flagged questions..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Question Review List / Table */}
          <div className="max-h-64 overflow-y-auto border border-slate-800 rounded-2xl divide-y divide-slate-800 bg-slate-950/60">
            {(reviewFilter === 'NEEDS_REVIEW' ? needsReviewQuestions : processedQuestions)
              .filter((q) => {
                if (!reviewSearch.trim()) return true;
                const sq = reviewSearch.toLowerCase().trim();
                return (
                  q.id.toLowerCase().includes(sq) ||
                  q.question.toLowerCase().includes(sq) ||
                  (q.reviewNote && q.reviewNote.toLowerCase().includes(sq))
                );
              })
              .map((q) => (
                <div key={q.id} className="p-3 space-y-1.5 hover:bg-slate-900/50 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-cyan-400 font-bold">{q.id}</span>
                      <span className="text-slate-400">({q.major} • {q.topic})</span>
                      {(q.needsReview || q.classificationStatus === 'NEEDS_REVIEW') && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          <span>NEEDS REVIEW</span>
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setSelectedReviewQuestion(q)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Inspect</span>
                    </button>
                  </div>

                  <p className="text-slate-200 font-medium truncate">{q.question}</p>

                  {q.reviewNote && (
                    <p className="text-amber-300/90 text-[11px] font-semibold flex items-center gap-1">
                      <span>Reason:</span> {q.reviewNote}
                    </p>
                  )}
                </div>
              ))}

            {(reviewFilter === 'NEEDS_REVIEW' ? needsReviewQuestions : processedQuestions).length === 0 && (
              <div className="p-8 text-center text-slate-500 space-y-1">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto" />
                <p>No questions requiring review under selected filter.</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <button
              onClick={() => setStep(3)}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            <button
              onClick={() => setStep(5)}
              className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold flex items-center gap-2 transition-all shadow-md shadow-cyan-500/20"
            >
              <span>Next: Final Import & Commit</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: Final Import & Commit */}
      {step === 5 && !importSummary && previewResult && (
        <div className="space-y-5 text-xs">
          <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>Import Confirmation Summary</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-400 text-[10px] block font-bold uppercase">Questions Ready</span>
                <span className="text-lg font-black text-emerald-400">{processedQuestions.length}</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-400 text-[10px] block font-bold uppercase">Exam Year</span>
                <span className="text-lg font-black text-cyan-400">{selectedYear}</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-400 text-[10px] block font-bold uppercase">Flagged For Review</span>
                <span className="text-lg font-black text-amber-400">{needsReviewQuestions.length}</span>
              </div>
            </div>
          </div>

          {/* Duplicate ID Handling Decision */}
          {previewResult.duplicateQuestions.length > 0 && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
              <div className="font-bold text-amber-300 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <span>
                  {previewResult.duplicateQuestions.length} Duplicate Question IDs Detected in Database
                </span>
              </div>
              <p className="text-slate-300 text-[11px]">
                Choose how to resolve duplicate IDs during commit:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label
                  onClick={() => setDuplicateAction('skip')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-2 ${
                    duplicateAction === 'skip'
                      ? 'bg-amber-500/20 border-amber-400 text-amber-100 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="dupAction"
                    checked={duplicateAction === 'skip'}
                    onChange={() => setDuplicateAction('skip')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs">Skip Duplicates</div>
                    <div className="text-[10px] text-slate-400 font-normal">
                      Import new questions only.
                    </div>
                  </div>
                </label>

                <label
                  onClick={() => setDuplicateAction('update')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-2 ${
                    duplicateAction === 'update'
                      ? 'bg-amber-500/20 border-amber-400 text-amber-100 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="dupAction"
                    checked={duplicateAction === 'update'}
                    onChange={() => setDuplicateAction('update')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs">Update Existing</div>
                    <div className="text-[10px] text-slate-400 font-normal">
                      Overwrite existing entries.
                    </div>
                  </div>
                </label>

                <label
                  onClick={() => setDuplicateAction('cancel')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-2 ${
                    duplicateAction === 'cancel'
                      ? 'bg-rose-500/20 border-rose-400 text-rose-100 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="dupAction"
                    checked={duplicateAction === 'cancel'}
                    onChange={() => setDuplicateAction('cancel')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs">Cancel Import</div>
                    <div className="text-[10px] text-slate-400 font-normal">
                      Abort import operation.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}

          {importError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 font-medium">
              {importError}
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <button
              onClick={() => setStep(4)}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            <button
              onClick={handleExecuteImport}
              disabled={duplicateAction === 'cancel' || isConfirming}
              className={`px-6 py-2.5 rounded-xl font-extrabold flex items-center gap-2 transition-all ${
                duplicateAction !== 'cancel' && !isConfirming
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
            >
              {isConfirming ? (
                <span>Writing to Question Bank Database...</span>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Import Question Bank</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: Success Result Banner */}
      {step === 5 && importSummary && (
        <div className="space-y-5 text-center py-6">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>

          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-100">Question Bank Batch Successfully Imported</h3>
            <p className="text-xs text-slate-400">
              {importSummary.count} questions committed to the MOH Question Bank for exam year{' '}
              <strong className="text-cyan-400">{selectedYear}</strong> with verified explanations and review flags.
            </p>
            <p className="text-[11px] text-slate-500 font-mono">Batch ID: {importSummary.batchId}</p>
          </div>

          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={handleReset}
              className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Import Another Batch</span>
            </button>

            {onCancel && (
              <button
                onClick={onCancel}
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold"
              >
                Return to Question Directory
              </button>
            )}
          </div>
        </div>
      )}

      {/* Inspect Question Modal */}
      {selectedReviewQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-cyan-400 font-bold text-sm">
                  {selectedReviewQuestion.id}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {selectedReviewQuestion.year}
                </span>
              </div>
              <button
                onClick={() => setSelectedReviewQuestion(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <span className="text-slate-400 font-semibold block mb-1">Question Stem:</span>
                <textarea
                  value={selectedReviewQuestion.question}
                  onChange={(e) => {
                    const updated = { ...selectedReviewQuestion, question: e.target.value };
                    setSelectedReviewQuestion(updated);
                    setProcessedQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
                  }}
                  className="w-full p-3 rounded-xl bg-slate-950 text-slate-100 border border-slate-800 focus:border-cyan-500 text-xs leading-relaxed font-medium"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <span className="text-slate-400 font-semibold block">Answer Options & AI Option Explanations (Editable):</span>
                {(['A', 'B', 'C', 'D'] as OptionKey[]).map((k) => (
                  <div key={k} className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded flex items-center justify-center font-bold text-[11px] ${
                        k === selectedReviewQuestion.correctAnswer ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                      }`}>
                        {k}
                      </span>
                      <input
                        type="text"
                        value={selectedReviewQuestion.options[k] || ''}
                        onChange={(e) => {
                          const newOpts = { ...selectedReviewQuestion.options, [k]: e.target.value };
                          const updated = { ...selectedReviewQuestion, options: newOpts };
                          setSelectedReviewQuestion(updated);
                          setProcessedQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
                        }}
                        className={`flex-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 font-semibold text-xs ${
                          k === selectedReviewQuestion.correctAnswer ? 'text-emerald-300' : 'text-slate-200'
                        }`}
                      />
                    </div>

                    {/* Editable Option Explanation */}
                    <div className="pl-7 space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-400 block">
                        Option {k} Medical Explanation:
                      </label>
                      <textarea
                        rows={2}
                        value={selectedReviewQuestion.optionExplanations?.[k] || ''}
                        onChange={(e) => {
                          const newOptExp = {
                            ...(selectedReviewQuestion.optionExplanations || {}),
                            [k]: e.target.value
                          };
                          const updated = { ...selectedReviewQuestion, optionExplanations: newOptExp };
                          setSelectedReviewQuestion(updated);
                          setProcessedQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
                        }}
                        placeholder={`Clinical explanation why choice ${k} is incorrect...`}
                        className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 focus:border-cyan-500"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <span className="text-slate-400 font-semibold block mb-1">Primary Answer Explanation:</span>
                <textarea
                  rows={3}
                  value={selectedReviewQuestion.explanation || ''}
                  onChange={(e) => {
                    const updated = { ...selectedReviewQuestion, explanation: e.target.value };
                    setSelectedReviewQuestion(updated);
                    setProcessedQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
                  }}
                  className="w-full p-3 rounded-xl bg-slate-950 text-slate-300 border border-slate-800 focus:border-cyan-500 leading-relaxed"
                />
              </div>

              <div className="space-y-1">
                <span className="text-slate-400 font-semibold block">Review Note / Status:</span>
                <input
                  type="text"
                  value={selectedReviewQuestion.reviewNote || ''}
                  onChange={(e) => {
                    const updated = { ...selectedReviewQuestion, reviewNote: e.target.value };
                    setSelectedReviewQuestion(updated);
                    setProcessedQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
                  }}
                  placeholder="Verification note or comment..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 text-amber-200 border border-slate-800 text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => {
                    // Mark as reviewed and close modal
                    const updated = {
                      ...selectedReviewQuestion,
                      needsReview: false,
                      classificationStatus: 'VERIFIED' as const
                    };
                    setSelectedReviewQuestion(null);
                    setProcessedQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
                >
                  <Check className="w-4 h-4" />
                  <span>Save & Mark Verified</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
