---
name: supabase-data-layer
description: Use ao criar funções de acesso a dados no VERTEXA web. Padroniza como telas leem/escrevem no Supabase via camada api/ tipada e react-query.
---
# Camada de dados Supabase (VERTEXA web)

Regras:
1. Telas NUNCA chamam supabase direto. Chamam funções de `src/lib/api/` via react-query.
2. Cada função é tipada (usa src/types/db.ts) e trata erro.
3. Só anon key. Nunca service_role no client.
4. Escopo por profissional/clínica sempre que a tabela tiver dono.

Template de função de leitura:
```ts
import { supabase } from '@/lib/supabase';
import type { Patient } from '@/types/db';

export async function getPatient(id: string): Promise<Patient> {
  const { data, error } = await supabase
    .from('patients').select('*, profiles(*)').eq('id', id).single();
  if (error) throw error;
  return data as Patient;
}
```
Template de hook:
```ts
import { useQuery } from '@tanstack/react-query';
export const usePatient = (id: string) =>
  useQuery({ queryKey: ['patient', id], queryFn: () => getPatient(id) });
```
Sempre exponha loading/empty/error para a tela renderizar skeleton/vazio/erro.
