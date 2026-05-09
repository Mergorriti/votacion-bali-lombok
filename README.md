# Votación familiar Bali, Lombok y Gili Air

App React + Vite preparada para Vercel y Supabase.

## Qué tienes que hacer ahora

1. Crea un proyecto en Supabase.
2. En Supabase, entra en `SQL Editor`, pega el contenido de `supabase/schema.sql` y ejecútalo.
3. Copia `.env.example` como `.env.local`.
4. En `.env.local`, rellena:

```bash
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY
```

5. Instala dependencias:

```bash
npm install
```

6. Prueba la app:

```bash
npm run dev
```

7. Publica en Vercel:

```bash
npm run build
```

Después sube el proyecto a GitHub, impórtalo en Vercel y añade las mismas variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Cómo se usa

- Cada hijo elige su nombre: Mercedes, Lucrecia, Alejandro o Fermín.
- Cada plan se vota de 1 a 4.
- Si alguien vuelve a tocar otro número, su voto se cambia.
- Los votos se guardan juntos en Supabase.
- Los resultados se actualizan para todos.
