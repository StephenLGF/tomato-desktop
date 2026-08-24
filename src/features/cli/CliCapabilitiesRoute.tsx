import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  RefreshCw,
  TerminalSquare,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { detectCliCapabilities, type CliCapability } from '@/lib/backend/cli';

export default function CliCapabilitiesRoute() {
  const [items, setItems] = useState<CliCapability[]>([]);
  const [loading, setLoading] = useState(true);

  const detect = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await detectCliCapabilities());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void detect();
  }, [detect]);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="flex h-14 items-center justify-between border-b px-5">
        <div>
          <h1 className="text-base font-semibold">CLI 能力</h1>
          <p className="text-xs text-muted-foreground">
            桌面端可直接调用的命令行工具
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void detect()}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          重新检测
        </Button>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        {loading && items.length === 0 ? (
          <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在检测 CLI…
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((item) => (
              <section key={item.id} className="rounded-xl border bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                      <TerminalSquare className="size-5" />
                    </span>
                    <div>
                      <h2 className="font-semibold">{item.name}</h2>
                      <code className="text-xs text-muted-foreground">
                        {item.command}
                      </code>
                    </div>
                  </div>
                  <Badge
                    variant={item.available ? 'default' : 'secondary'}
                    className="gap-1"
                  >
                    {item.available ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <CircleAlert className="size-3" />
                    )}
                    {!item.installed
                      ? '未安装'
                      : item.available
                        ? '可用'
                        : '需配置'}
                  </Badge>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  {item.description}
                </p>
                {item.version && (
                  <p className="mt-3 break-words font-mono text-xs">
                    {item.version}
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.status}
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {item.capabilities.map((capability) => (
                    <Badge
                      key={capability}
                      variant="outline"
                      className="font-normal"
                    >
                      {capability}
                    </Badge>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
