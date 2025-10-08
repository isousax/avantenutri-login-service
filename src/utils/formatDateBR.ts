import { DateTime } from "luxon";

// Função para formatar string ISO em data/hora no fuso de São Paulo
const formatDateBR = (dateString: string) => {
  try {
    const date = DateTime.fromISO(dateString, { zone: "utc" }).setZone("America/Sao_Paulo");
    if (!date.isValid) throw new Error("Data inválida");
    return date.toFormat("dd/MM/yyyy HH:mm");
  } catch {
    return "Data não disponível";
  }
};

// Objeto DateTime com a data/hora atual em São Paulo
const now = DateTime.utc().setZone("America/Sao_Paulo");

export { formatDateBR, now };