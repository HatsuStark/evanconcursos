-- O backend (chave de serviço) usa a mesma regra de correção na entrega do simulado.
grant execute on function public.record_answer_for(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid) to service_role;
