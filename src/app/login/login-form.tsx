"use client";

import React, { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  requestOtpAction,
  verifyOtpAction,
  loginWithPasswordAction,
  registerAction,
} from "./actions";
import { ShieldCheck, Mail, Lock, User, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";

export function LoginForm({ needsSetup }: { needsSetup: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"signin" | "signup">(needsSetup ? "signup" : "signin");
  const [signInMethod, setSignInMethod] = useState<"password" | "otp">("password");
  const [otpStep, setOtpStep] = useState<"email" | "code">("email");

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);

  // Status and feedback
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);

  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // 1. Handle Sign In with Password
  const handlePasswordSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    startTransition(async () => {
      const res = await loginWithPasswordAction({ email, password });
      if (!res.ok) {
        setError(res.error || "Invalid email or password.");
        return;
      }
      router.replace("/");
      router.refresh();
    });
  };

  // 2. Handle Create Account (Sign Up)
  const handleSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    startTransition(async () => {
      const res = await registerAction({ name, email, password });
      if (!res.ok) {
        setError(res.error || "Failed to create account.");
        return;
      }
      router.replace("/");
      router.refresh();
    });
  };

  // 3. Request OTP Code
  const handleRequestOtp = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoBanner(null);

    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid business email address.");
      return;
    }

    startTransition(async () => {
      const res = await requestOtpAction(email);
      if (!res.ok) {
        setError(res.error || "Failed to send verification code.");
        return;
      }

      setOtpStep("code");
      if (res.codePreview) {
        setInfoBanner(`Dev Preview Code: ${res.codePreview} (Add RESEND_API_KEY in Vercel to deliver live emails).`);
      } else {
        setInfoBanner(`Verification code sent to ${email}. Please check your inbox.`);
      }

      setTimeout(() => {
        otpInputsRef.current[0]?.focus();
      }, 100);
    });
  };

  // 4. Handle OTP Digit Inputs
  const handleOtpChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const nextDigits = [...otpDigits];
    nextDigits[index] = digit;
    setOtpDigits(nextDigits);

    if (digit && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }

    const fullCode = nextDigits.join("");
    if (fullCode.length === 6) {
      handleVerifyOtp(fullCode);
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;

    const nextDigits = [...otpDigits];
    for (let i = 0; i < 6; i++) {
      nextDigits[i] = pasted[i] || "";
    }
    setOtpDigits(nextDigits);

    if (pasted.length === 6) {
      handleVerifyOtp(pasted);
    } else {
      otpInputsRef.current[Math.min(pasted.length, 5)]?.focus();
    }
  };

  const handleVerifyOtp = (fullCode?: string) => {
    const code = fullCode || otpDigits.join("");
    if (code.length !== 6) {
      setError("Please enter all 6 digits of the verification code.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await verifyOtpAction({
        email,
        code,
        ownerName: name.trim() || undefined,
        ownerPassword: password || undefined,
      });

      if (!res.ok) {
        setError(res.error || "Verification failed.");
        return;
      }

      router.replace("/");
      router.refresh();
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#09090b] p-4 text-zinc-100 selection:bg-zinc-800">
      <div className="w-full max-w-[420px] rounded-2xl border border-zinc-800/80 bg-[#121215] p-8 shadow-2xl shadow-black/80 space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-1.5">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <img
              src="/logo.png"
              alt="Astraventa"
              className="h-9 w-9 object-contain"
            />
            <span className="text-base font-bold tracking-tight text-white">
              ASTRAVENTA
            </span>
          </div>

          <h1 className="text-lg font-bold text-white tracking-tight">
            {tab === "signup" ? "Create Your CRM Account" : "Sign In to Astraventa CRM"}
          </h1>
          <p className="text-xs text-zinc-400">
            {tab === "signup"
              ? "Set up your account to start qualifying leads and managing calls."
              : "Access your leads, caller queues, and real-time pipeline."}
          </p>
        </div>

        {/* Primary Tabs: Sign In / Create Account */}
        <div className="flex rounded-xl bg-[#09090b] p-1 border border-zinc-800 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setTab("signin");
              setError(null);
              setInfoBanner(null);
            }}
            className={`flex-1 py-2 rounded-lg transition-all ${
              tab === "signin"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("signup");
              setError(null);
              setInfoBanner(null);
            }}
            className={`flex-1 py-2 rounded-lg transition-all ${
              tab === "signup"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Feedback Banners */}
        {error && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-200 flex items-start gap-2">
            <span className="text-rose-400 mt-0.5">&bull;</span>
            <div className="flex-1">{error}</div>
          </div>
        )}

        {infoBanner && (
          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-700/80 text-xs text-zinc-300 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1">{infoBanner}</div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 1: SIGN IN                                                */}
        {/* ============================================================= */}
        {tab === "signin" && (
          <div className="space-y-4">
            {/* Sub-selector: Password vs Email OTP */}
            <div className="flex items-center justify-between text-[11px] text-zinc-400 pb-1">
              <span>Sign in method:</span>
              <button
                type="button"
                onClick={() => {
                  setSignInMethod(signInMethod === "password" ? "otp" : "password");
                  setError(null);
                  setInfoBanner(null);
                  setOtpStep("email");
                }}
                className="text-zinc-300 hover:text-white underline font-medium"
              >
                {signInMethod === "password" ? "Use Email Code (OTP) instead" : "Use Password instead"}
              </button>
            </div>

            {/* Method A: Password */}
            {signInMethod === "password" && (
              <form onSubmit={handlePasswordSignIn} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      autoComplete="email"
                      className="w-full rounded-xl border border-zinc-800 bg-[#09090b] pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none transition"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="w-full rounded-xl border border-zinc-800 bg-[#09090b] pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none transition"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isPending}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-white hover:bg-zinc-200 text-black py-2.5 text-xs font-bold transition shadow-sm disabled:opacity-50"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Signing In...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign In</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Method B: Email OTP */}
            {signInMethod === "otp" && otpStep === "email" && (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      autoComplete="email"
                      className="w-full rounded-xl border border-zinc-800 bg-[#09090b] pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none transition"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isPending}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-white hover:bg-zinc-200 text-black py-2.5 text-xs font-bold transition shadow-sm disabled:opacity-50"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Sending Code...</span>
                    </>
                  ) : (
                    <>
                      <span>Send Verification Code</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </form>
            )}

            {signInMethod === "otp" && otpStep === "code" && (
              <div className="space-y-5">
                <div className="space-y-1 text-center">
                  <span className="text-xs text-zinc-400">
                    Enter the 6-digit code sent to:
                  </span>
                  <div className="text-xs font-semibold text-white">{email}</div>
                </div>

                <div className="flex justify-between gap-2" onPaste={handleOtpPaste}>
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        otpInputsRef.current[idx] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      className="w-11 h-12 text-center text-lg font-bold rounded-xl border border-zinc-800 bg-[#09090b] text-white focus:border-white focus:outline-none transition"
                    />
                  ))}
                </div>

                <button
                  type="button"
                  disabled={isPending || otpDigits.join("").length !== 6}
                  onClick={() => handleVerifyOtp()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-white hover:bg-zinc-200 text-black py-2.5 text-xs font-bold transition shadow-sm disabled:opacity-50"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Verify Code &amp; Sign In</span>
                    </>
                  )}
                </button>

                <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-2 border-t border-zinc-800/80">
                  <button
                    type="button"
                    onClick={() => {
                      setOtpStep("email");
                      setOtpDigits(["", "", "", "", "", ""]);
                      setError(null);
                    }}
                    className="hover:text-white transition"
                  >
                    &larr; Change email
                  </button>

                  <button
                    type="button"
                    onClick={handleRequestOtp}
                    disabled={isPending}
                    className="text-zinc-300 hover:text-white font-medium underline"
                  >
                    Resend code
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 2: CREATE ACCOUNT (SIGN UP)                              */}
        {/* ============================================================= */}
        {tab === "signup" && (
          <form onSubmit={handleSignUp} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Haider"
                  className="w-full rounded-xl border border-zinc-800 bg-[#09090b] pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none transition"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                  className="w-full rounded-xl border border-zinc-800 bg-[#09090b] pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none transition"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                <span>Create Password</span>
                <span className="text-zinc-500 text-[10px]">Min. 8 characters</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-zinc-800 bg-[#09090b] pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-white hover:bg-zinc-200 text-black py-2.5 text-xs font-bold transition shadow-sm disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating Account...</span>
                </>
              ) : (
                <>
                  <span>Create Account &amp; Launch CRM</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Security Footer */}
        <div className="text-center pt-2 border-t border-zinc-800/80">
          <p className="text-[11px] text-zinc-500 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-zinc-500" />
            <span>Encrypted with scrypt &amp; HMAC sessions</span>
          </p>
        </div>
      </div>
    </div>
  );
}
