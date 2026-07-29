import { useRef, useState, type DragEvent } from 'react';
import { questionsApi } from '../../lib/endpoints';
import type { BulkImportResult } from '../../lib/types';

export function BulkImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setFilename(file.name);

    try {
      setResult(await questionsApi.bulkImport(file));
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })
        .response?.data?.message;
      setError(message ?? 'The upload failed. Check the file and try again.');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bulk import</h1>
          <p>
            Upload a CSV or Excel sheet. Rows import independently — a bad row is
            reported and skipped, never failing the whole file.
          </p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="stack">
        <div
          className={`dropzone ${dragging ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,.txt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = '';
            }}
          />
          <strong>{busy ? 'Importing…' : 'Drop a spreadsheet here'}</strong>
          <span className="muted small">
            or click to browse — .csv, .xlsx, up to 5 MB
          </span>
        </div>

        <div className="card card-pad">
          <div className="spread">
            <div>
              <h2>Not sure about the columns?</h2>
              <p className="muted small" style={{ margin: '3px 0 0' }}>
                Download a starter sheet with the exact headers and a worked
                example.
              </p>
            </div>
            <div className="row">
              <button onClick={() => void questionsApi.downloadTemplate('mcq')}>
                MCQ template
              </button>
              <button
                onClick={() => void questionsApi.downloadTemplate('personality')}
              >
                Personality template
              </button>
            </div>
          </div>
        </div>

        {result && (
          <div className="card">
            <div className="card-head">
              <h2>Result — {filename}</h2>
              <span className={`badge ${result.failed === 0 ? 'active' : 'draft'}`}>
                {result.imported} of {result.totalRows} imported
              </span>
            </div>

            <div className="card-pad">
              <div className="grid" style={{ marginBottom: result.failed ? 16 : 0 }}>
                <div className="stat">
                  <div className="label">Rows read</div>
                  <div className="value">{result.totalRows}</div>
                </div>
                <div className="stat">
                  <div className="label">Imported</div>
                  <div className="value" style={{ color: 'var(--success)' }}>
                    {result.imported}
                  </div>
                  <div className="sub">as {result.importedAs}</div>
                </div>
                <div className="stat">
                  <div className="label">Failed</div>
                  <div
                    className="value"
                    style={{ color: result.failed ? 'var(--danger)' : undefined }}
                  >
                    {result.failed}
                  </div>
                </div>
              </div>

              {result.imported > 0 && (
                <div className="alert info" style={{ marginBottom: 0 }}>
                  Imported questions land as <strong>draft</strong>. Review them in
                  the question bank and activate the ones you want served.
                </div>
              )}
            </div>

            {result.failures.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Sheet row</th>
                      <th>Question</th>
                      <th>Why it was skipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.failures.map((f) => (
                      <tr key={f.row}>
                        {/* Row numbers match what you see in Excel. */}
                        <td className="mono">{f.row}</td>
                        <td className="muted">{f.questionText ?? '—'}</td>
                        <td style={{ color: 'var(--danger)' }}>{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
