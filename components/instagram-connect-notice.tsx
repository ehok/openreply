"use client";

import { useSearchParams } from "next/navigation";

type Tone = "error" | "warning" | "success";

const TONE_CLASSES: Record<Tone, string> = {
  error: "border-error/20 bg-error/10 text-error",
  warning: "border-warning/20 bg-warning/10 text-warning",
  success: "border-success/20 bg-success/10 text-success",
};

const MESSAGES: Record<string, { tone: Tone; title: string; detail: string }> = {
  denied: {
    tone: "warning",
    title: "Instagram bağlantısı iptal edildi",
    detail:
      "Instagram'daki izin ekranını reddettiniz. Yeniden başlatıp istenen tüm izinleri kabul edin.",
  },
  invalid: {
    tone: "error",
    title: "Instagram bağlantısının süresi doldu",
    detail:
      "Giriş bağlantısı eksikti veya 10 dakikadan eskiydi. Yeniden denemek için Instagram Bağla'ya tıklayın.",
  },
  forbidden: {
    tone: "error",
    title: "İzin yok",
    detail:
      "Instagram hesabı yalnızca çalışma alanı sahipleri ve yöneticileri bağlayabilir.",
  },
  already_connected: {
    tone: "warning",
    title: "Hesap zaten bağlı",
    detail:
      "Bu Instagram hesabı başka bir çalışma alanına bağlı. Önce oradaki bağlantıyı kesin ya da farklı bir hesap bağlayın.",
  },
};

export function InstagramConnectNotice() {
  const searchParams = useSearchParams();
  const status = searchParams.get("instagram");

  if (!status) return null;

  if (status === "misconfigured") {
    const missing = (searchParams.get("missing") ?? "")
      .split(",")
      .filter(Boolean);

    return (
      <Notice tone="error" title="Instagram uygulaması yapılandırılmamış">
        <p>
          {missing.length > 0
            ? "Şu ortam değişkenlerini"
            : "Gerekli ortam değişkenlerini"}{" "}
          tanımlayıp sunucuyu yeniden başlatın:
        </p>
        {missing.length > 0 && (
          <ul className="mt-2 space-y-1">
            {missing.map((name) => (
              <li key={name} className="font-mono text-xs">
                {name}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2">
          Her değerin nereden alınacağı için{" "}
          <span className="font-mono text-xs">docs/setup.md</span> dosyasına
          bakın. <span className="font-mono text-xs">ENCRYPTION_KEY</span> tam 64
          karakterlik onaltılık bir dizi olmalıdır.
        </p>
      </Notice>
    );
  }

  if (status === "failed") {
    const reason = searchParams.get("reason");

    return (
      <Notice tone="error" title="Instagram bağlantısı başarısız">
        <p>
          Instagram girişi kabul etti ama bağlantı tamamlanamadı. Bunun genel
          sebebi eşleşmeyen bir yönlendirme adresi ya da gerekli izinleri
          eksik bir uygulamadır.
        </p>
        {reason && (
          <p className="mt-2 font-mono text-xs break-words opacity-80">
            {reason}
          </p>
        )}
      </Notice>
    );
  }

  const known = MESSAGES[status];
  if (!known) return null;

  return (
    <Notice tone={known.tone} title={known.title}>
      <p>{known.detail}</p>
    </Notice>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded border p-4 text-sm ${TONE_CLASSES[tone]}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 opacity-90">{children}</div>
    </div>
  );
}
