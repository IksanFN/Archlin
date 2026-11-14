import { describe, expect, it, vi } from 'vitest';
import { notifyPageChanged, notifyTreeMutation, subscribePageChanged, subscribeTreeMutation } from './tree-sync';

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

  it('notifyPageChanged passes the entity id to page listeners only', () => {
    const pages: string[] = [];
    let tree = 0;
    const offPage = subscribePageChanged((id) => pages.push(id));
    const offTree = subscribeTreeMutation(() => {
      tree += 1;
    });
    notifyPageChanged('e1');
    expect(pages).toEqual(['e1']);
    expect(tree).toBe(0);
    offPage();
    offTree();
    notifyPageChanged('e2');
    expect(pages).toEqual(['e1']);
  });
});
