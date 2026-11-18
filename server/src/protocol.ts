// Протокол живе в shared (Zod-схеми). Сервер лише реекспортує потрібне
// і додає серверний ліміт розміру повідомлення.
export {
	CLOSE,
	make,
	PROTOCOL_VERSION,
	parseClientMessage,
} from "biplane-shared/protocol/index.ts";

export const MAX_MESSAGE_BYTES = 2048;
