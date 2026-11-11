import { v7 } from 'uuid';

export interface Ids {
  uuidv7(): string;
}

// uuid's v7 is monotonic within the same millisecond, which keeps ids sortable in creation order.
export const systemIds: Ids = {
  uuidv7: () => v7(),
};
