import { describe, expect, it, vi } from 'vitest';
import { notifyTreeMutation, subscribeTreeMutation } from './tree-sync';

describe('tree-sync', () => {
  it('notifies current subscribers and unsubscribe stops delivery', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeTreeMutation(first);
    const stopSecond = subscribeTreeMutation(second);
    notifyTreeMutation();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    notifyTreeMutation();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
  });
});
