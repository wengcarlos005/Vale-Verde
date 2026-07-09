// Conexão Socket.IO autenticada com a sala da fazenda.
import { session } from './api.js';

export function connect(farmId) {
  return io({ auth: { token: session.token, farmId } });
}
