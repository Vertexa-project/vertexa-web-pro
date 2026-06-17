import { useQuery } from "@tanstack/react-query";

import { getPatient, listPatients } from "@/lib/api/patients";
import { qk } from "@/lib/queryKeys";

export const useListPatients = () =>
  useQuery({ queryKey: qk.patients, queryFn: listPatients });

export const usePatient = (id: string) =>
  useQuery({ queryKey: qk.patient(id), queryFn: () => getPatient(id), enabled: Boolean(id) });
