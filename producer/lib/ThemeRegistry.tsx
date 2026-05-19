'use client';

import { useState } from 'react';
import createCache, { EmotionCache } from '@emotion/cache';
import { useServerInsertedHTML } from 'next/navigation';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

const theme = createTheme();

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  const [{ cache, flush }] = useState<{
    cache: EmotionCache;
    flush: () => string[];
  }>(() => {
    const c = createCache({ key: 'mui' });
    c.compat = true;
    const prevInsert = c.insert.bind(c);
    const inserted: string[] = [];

    c.insert = (...args: Parameters<typeof prevInsert>) => {
      const [, serialized] = args;
      if (c.inserted[serialized.name] === undefined) {
        inserted.push(serialized.name);
      }
      return prevInsert(...args);
    };

    return {
      cache: c,
      flush: () => {
        const prev = [...inserted];
        inserted.length = 0;
        return prev;
      },
    };
  });

  useServerInsertedHTML(() => {
    const names = flush();
    if (names.length === 0) return null;
    const styles = names.map((n) => cache.inserted[n]).join('');
    return (
      <style
        key={cache.key}
        data-emotion={`${cache.key} ${names.join(' ')}`}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}
