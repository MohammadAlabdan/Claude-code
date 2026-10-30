import { broadcast } from "./broadcast.ts";
import type { Json } from "./db.ts";
import { HttpError } from "./http.ts";
import { deliver, type Notify } from "./push.ts";

/**
 * Takes a SQL action result: throws on {error}, sends its pushes and broadcast,
 * and returns the result without the internal "notify"/"broadcast" fields.
 */
export async function settle(result: Json): Promise<Json> {
  if (result && "error" in result) {
    const { error, ...extra } = result;
    throw new HttpError(String(error), extra);
  }
  const { notify, broadcast: publicId, ...rest } = result;
  await Promise.all([deliver(notify as Notify[] | undefined), broadcast(publicId as string | undefined)]);
  return rest;
}
