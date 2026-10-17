import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/index.js';

describe('quant-fusion CLI', () => {
  it('prints help and exits 0 with no arguments', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await run([]);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('quant-fusion - research models and simulated portfolios'),
    );
    log.mockRestore();
  });

  it('prints the version and exits 0 for --version', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await run(['--version']);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith('0.1.0');
    log.mockRestore();
  });

  it.each(['games', 'bots'])('reports "%s" as not yet implemented and exits 0', async (command) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await run([command]);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(`'${command}' is not yet implemented.`);
    log.mockRestore();
  });

  it('exits 1 and prints an error for an unknown command', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await run(['not-a-real-command']);
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown command: not-a-real-command');
    error.mockRestore();
    log.mockRestore();
  });

  describe('match', () => {
    it('reports bare "match" as not yet implemented and exits 0', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await run(['match']);
      expect(code).toBe(0);
      expect(log).toHaveBeenCalledWith("'match' is not yet implemented.");
      log.mockRestore();
    });

    it('exits 1 and prints an error for an unknown match subcommand', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run(['match', 'not-a-real-subcommand']);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(
        'Unknown match subcommand: "not-a-real-subcommand". Only "run" and "forward" exist today.',
      );
      error.mockRestore();
    });

    it('exits 1 with a usage message when "match run" gets fewer than 2 bot ids', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run(['match', 'run', 'only-rock']);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage: quant-fusion match run'));
      error.mockRestore();
    });

    it('exits 1 and prints an error for an unknown "match forward" subcommand', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run(['match', 'forward', 'not-a-real-subcommand']);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(
        'Unknown match forward subcommand: "not-a-real-subcommand". Only "run", "list", ' +
          '"inspect", "preview", "refresh", "status", "pin-status", and "end" exist today.',
      );
      error.mockRestore();
    });

    it('exits 1 with a usage message when "match forward run" gets no matchId/bot ids', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run(['match', 'forward', 'run']);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Usage: quant-fusion match forward run'),
      );
      error.mockRestore();
    });
  });
});
