/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Wand2,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  ArrowRight,
  History,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Groq from "groq-sdk";
import ReactMarkdown from 'react-markdown';

// --- Types ---

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: any) => void;
  onend: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// --- App Component ---

export default function App() {
  // State
  const [rawText, setRawText] = useState('');
  const [correctedText, setCorrectedText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(1); // 1: Oidor, 2: Corrector, 3: Publicador

  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        setRawText(prev => prev + finalTranscript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setError(`Error de reconocimiento: ${event.error}`);
        setIsListening(false);
      };

      recognition.onend = () => {
        // Only restart if we intentionally want to keep listening
        // and aren't moving on to correct the text
        if (isListening && !isCorrecting && activeStep === 1) {
          try {
            recognition.start();
          } catch (e) {
            console.warn('Recognition already started or cannot start', e);
          }
        } else {
          // We finished listening, ensure state reflects that
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
    } else {
      setError('Tu navegador no soporta el reconocimiento de voz.');
    }
  }, [isListening]);

  const toggleListening = () => {
    if (isListening) {
      setIsListening(false);
      recognitionRef.current?.stop();
      // Only proceed to step 2 if they actually want to correct it and we don't have a correction yet
      if (rawText.trim() && !correctedText) setActiveStep(2);
    } else {
      setError(null);
      // Try to forcefully abort any ghost processes
      try { recognitionRef.current?.abort(); } catch (e) { }

      // Restart fresh if we already corrected something previously
      if (correctedText) {
        setRawText('');
        setCorrectedText('');
      }

      setActiveStep(1);

      // Delay starting slightly to ensure the abort() has fully resolved in the browser's audio stack
      setTimeout(() => {
        setIsListening(true);
        try {
          recognitionRef.current?.start();
        } catch (e) {
          console.warn('Recognition start error', e);
          setIsListening(false);
        }
      }, 50);
    }
  };

  const handleCorrect = async () => {
    if (!rawText.trim()) return;

    setIsCorrecting(true);
    setActiveStep(2);
    setError(null);

    try {
      const groq = new Groq({
        apiKey: process.env.GROQ_API_KEY,
        dangerouslyAllowBrowser: true
      });
      const response = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          {
            role: "system",
            content: `You are an expert editing and proofreading agent. Your task is to receive a voice transcription (which may contain grammatical errors, lack of punctuation, or repetitions) and turn it into a professional, fluent, and well-structured text.\n\nCRITICAL RULES:\n1. IDENTIFY THE LANGUAGE OF the original text and output the corrected version IN THE EXACT SAME LANGUAGE. DO NOT TRANSLATE IT TO SPANISH.\n2. Do NOT change the original meaning of what was said.\n3. Improve punctuation and grammar appropriately for the identified language.\n4. Remove filler words (uh, um, you know...). \n5. If the text is long, use paragraphs.\n6. Return ONLY the corrected text in Markdown format, without any conversational introductory or concluding text.`
          },
          {
            role: "user",
            content: `Texto a corregir:\n"${rawText}"`
          }
        ]
      });

      const result = response.choices[0]?.message?.content;
      if (result) {
        setCorrectedText(result);
        setActiveStep(3);
      } else {
        throw new Error("No se recibió respuesta del corrector.");
      }
    } catch (err: any) {
      console.error(err);
      setError("Hubo un problema al corregir el texto. Por favor, intenta de nuevo.");
    } finally {
      setIsCorrecting(false);
    }
  };

  const downloadText = () => {
    const element = document.createElement("a");
    const file = new Blob([correctedText || rawText], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `escrito_corregido_${new Date().getTime()}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const reset = () => {
    setRawText('');
    setCorrectedText('');
    setActiveStep(1);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-300 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-zinc-800/50 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Wand2 className="w-5 h-5 text-black" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Agentes de Redacción</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={reset}
              className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-500 hover:text-zinc-300"
              title="Reiniciar"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <div className="text-xs font-mono bg-zinc-800 px-2 py-1 rounded text-zinc-400">
              v1.0.0
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-12 gap-4">
          {[1, 2, 3].map((step) => (
            <React.Fragment key={step}>
              <div className={`flex items-center gap-2 ${activeStep >= step ? 'text-emerald-400' : 'text-zinc-600'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${activeStep === step ? 'border-emerald-500 bg-emerald-500/10 scale-110' :
                  activeStep > step ? 'border-emerald-500 bg-emerald-500' : 'border-zinc-800'
                  }`}>
                  {activeStep > step ? <CheckCircle2 className="w-5 h-5 text-black" /> : <span className="text-xs font-bold">{step}</span>}
                </div>
                <span className="text-xs font-medium uppercase tracking-widest hidden sm:inline">
                  {step === 1 ? 'Oidor' : step === 2 ? 'Corrector' : 'Publicador'}
                </span>
              </div>
              {step < 3 && <div className={`h-[2px] w-12 rounded-full transition-all duration-500 ${activeStep > step ? 'bg-emerald-500' : 'bg-zinc-800'}`} />}
            </React.Fragment>
          ))}
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400"
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* AGENT 1: OIDOR */}
          <section className={`agent-card ${activeStep === 1 ? 'active' : ''}`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${isListening ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-zinc-800 text-zinc-400'}`}>
                  <Mic className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-white">Agente Oidor</h2>
                  <p className="text-[10px] text-zinc-500 font-mono uppercase">Status: {isListening ? 'Escuchando' : 'En espera'}</p>
                </div>
              </div>
            </div>

            <div className="relative mb-6">
              <div className="h-64 bg-black/40 rounded-xl border border-zinc-800 p-4 font-serif text-lg overflow-y-auto custom-scrollbar">
                {rawText ? (
                  <div className="relative group min-h-full">
                    <p className="text-zinc-300 leading-relaxed italic pr-8">"{rawText}"</p>
                    {!isListening && (
                      <button
                        onClick={() => { setRawText(''); setActiveStep(1); }}
                        className="absolute top-0 right-0 p-2 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded-lg"
                        title="Borrar texto y empezar de nuevo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-center">
                    <History className="w-10 h-10 mb-3 opacity-20" />
                    <p className="text-sm italic">Presiona el botón para comenzar a hablar...</p>
                  </div>
                )}
              </div>
              {isListening && (
                <div className="absolute bottom-4 right-4 flex gap-1">
                  {[1, 2, 3].map(i => (
                    <motion.div
                      key={i}
                      animate={{ height: [4, 12, 4] }}
                      transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                      className="w-1 bg-emerald-500 rounded-full"
                    />
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={toggleListening}
              className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all ${isListening
                ? 'bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20'
                : 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-lg shadow-emerald-500/20'
                }`}
            >
              {isListening ? (
                <><MicOff className="w-5 h-5" /> Detener Escucha</>
              ) : (
                <><Mic className="w-5 h-5" /> Iniciar Escucha</>
              )}
            </button>
          </section>

          {/* AGENT 2: CORRECTOR */}
          <section className={`agent-card ${activeStep === 2 ? 'active' : ''}`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${isCorrecting ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
                  <Wand2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-white">Agente Corrector</h2>
                  <p className="text-[10px] text-zinc-500 font-mono uppercase">Status: {isCorrecting ? 'Procesando' : correctedText ? 'Completado' : 'Inactivo'}</p>
                </div>
              </div>
            </div>

            <div className="h-64 bg-black/40 rounded-xl border border-zinc-800 p-4 overflow-y-auto custom-scrollbar mb-6">
              {isCorrecting ? (
                <div className="h-full flex flex-col items-center justify-center text-emerald-500/50">
                  <Loader2 className="w-10 h-10 animate-spin mb-3" />
                  <p className="text-sm font-mono animate-pulse">Refinando el texto...</p>
                </div>
              ) : correctedText ? (
                <div className="markdown-body text-sm">
                  <ReactMarkdown>{correctedText}</ReactMarkdown>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-center">
                  <FileText className="w-10 h-10 mb-3 opacity-20" />
                  <p className="text-sm italic">El texto corregido aparecerá aquí...</p>
                </div>
              )}
            </div>

            <button
              onClick={handleCorrect}
              disabled={!rawText || isCorrecting || isListening}
              className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all ${!rawText || isCorrecting || isListening
                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                : 'bg-white text-black hover:bg-zinc-200'
                }`}
            >
              {isCorrecting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Corrigiendo...</>
              ) : (
                <><Wand2 className="w-5 h-5" /> Corregir Escrito</>
              )}
            </button>
          </section>

          {/* AGENT 3: PUBLICADOR */}
          <section className={`agent-card ${activeStep === 3 ? 'active' : ''}`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${correctedText ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-800 text-zinc-400'}`}>
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-white">Agente Publicador</h2>
                  <p className="text-[10px] text-zinc-500 font-mono uppercase">Status: {correctedText ? 'Listo para publicar' : 'Esperando'}</p>
                </div>
              </div>
            </div>

            <div className="h-64 bg-zinc-800/20 rounded-xl border border-dashed border-zinc-700 p-6 flex flex-col items-center justify-center text-center mb-6">
              {correctedText ? (
                <>
                  <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  </div>
                  <h3 className="text-white font-semibold mb-2">¡Documento Listo!</h3>
                  <p className="text-xs text-zinc-500">El agente ha verificado y formateado tu escrito para su distribución final.</p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mb-4 opacity-50">
                    <Download className="w-8 h-8 text-zinc-600" />
                  </div>
                  <p className="text-xs text-zinc-600 italic">Completa los pasos anteriores para habilitar la publicación.</p>
                </>
              )}
            </div>

            <button
              onClick={downloadText}
              disabled={!correctedText}
              className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all ${!correctedText
                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                : 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-lg shadow-emerald-500/20'
                }`}
            >
              <Download className="w-5 h-5" /> Descargar Escrito (.txt)
            </button>
          </section>

        </div>

        {/* Footer Info */}
        <footer className="mt-20 pt-8 border-t border-zinc-800/50 flex flex-col sm:flex-row items-center justify-between gap-4 text-zinc-500">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-[10px] font-mono uppercase tracking-widest">Sistemas Operativos</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
              <span className="text-[10px] font-mono uppercase tracking-widest">IA Conectada</span>
            </div>
          </div>
          <p className="text-[10px] font-mono uppercase tracking-widest">© 2024 Agentes Studio • IA de Redacción Avanzada</p>
        </footer>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}</style>
    </div>
  );
}
