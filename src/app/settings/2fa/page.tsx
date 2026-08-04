"use client";
import { useState } from "react";

export default function TwoFactorSetup() {
  const [secret, setSecret] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [enabled, setEnabled] = useState(false);

  const enable2FA = async () => {
    const res = await fetch("https://aether.aetherord.workers.dev/api/auth/2fa", { method: "POST", body: JSON.stringify({ userId: 1 }) }); // replace with real user ID
    const data = (await res.json()) as { secret: string; qrUrl: string };
    setSecret(data.secret);
    setQrUrl(data.qrUrl);
  };

  const verifyAndSave = async () => {
    // TODO: Send code to backend to verify and save secret permanently
    setEnabled(true);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-8">
        <h1 className="text-2xl font-medium mb-4">Two-Factor Authentication</h1>
        {!enabled ? (
          <>
            <button
              onClick={enable2FA}
              className="w-full py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition"
            >
              Enable 2FA
            </button>
            {qrUrl && (
              <div className="mt-6">
                <p className="text-sm text-gray-400 mb-2">Scan this QR code with your authenticator app:</p>
                <img src={qrUrl} alt="2FA QR Code" className="mx-auto bg-white p-2 rounded" />
                <p className="text-xs text-gray-500 mt-2 break-all">Secret: {secret}</p>
                <input
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full mt-4 px-4 py-2 bg-black/30 border border-white/10 rounded-xl text-white"
                />
                <button
                  onClick={verifyAndSave}
                  className="w-full mt-2 py-2 rounded-full bg-blue-600 hover:bg-blue-700 transition"
                >
                  Verify & Save
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-green-400">? 2FA is enabled on your account.</p>
        )}
      </div>
    </div>
  );
}

