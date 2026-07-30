import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { newDraft } from '../core/draft.js';
import {
  normalizeEan,
  normalizeName,
  parsePriceCents,
  parseWeightGrams,
} from '../core/normalize.js';
import { saveDraft, syncDrafts } from '../lib/store.js';
import { productTypeForCategory } from './manual.js';
import { icon } from '../ui/icons.js';
import { esc, escAttr, renderFocusedHeader, toast } from '../ui/shell.js';

const fieldOptions = [
  ['', 'Ignora'],
  ['name', 'Nome'],
  ['price', 'Prezzo'],
  ['description', 'Descrizione'],
  ['category_slug', 'Categoria'],
  ['weight', 'Pezzatura'],
  ['quantity', 'Quantità'],
  ['barcode', 'Barcode'],
];

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('it-IT')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}€]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('it-IT')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const mappingRules = [
  ['name', (header) => /^(nome|prodotto|articolo|descrizione breve|denominazione)$/.test(header)],
  ['price', (header, original) => /prezzo|costo|listino/.test(header) || original.includes('€')],
  ['category_slug', (header) => /categoria|reparto|famiglia|tipologia/.test(header)],
  ['weight', (header) => /peso|pezzatura|formato|grammatura/.test(header)],
  ['quantity', (header) => /quantita|giacenza|disponibilita|stock/.test(header)],
  ['barcode', (header) => /barcode|codice a barre|ean|gtin/.test(header)],
  ['description', (header) => /^(note?|descrizione|dettagli|testo)$/.test(header)],
];

export function guessColumnMapping(headers) {
  const mapping = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const [field, matches] of mappingRules) {
      if (!(field in mapping) && matches(normalized, String(header))) {
        mapping[field] = index;
        break;
      }
    }
  });
  return mapping;
}

function cell(row, mapping, field) {
  const index = mapping[field];
  return Number.isInteger(index) ? row[index] : '';
}

export function rowToDraftParsed(row, mapping) {
  const rawPrice = cell(row, mapping, 'price');
  const parsedPrice = parsePriceCents(String(rawPrice ?? ''));
  const grams = parseWeightGrams(String(cell(row, mapping, 'weight') ?? ''));
  const quantity = Math.max(0, Number.parseInt(cell(row, mapping, 'quantity'), 10) || 0);
  const categorySlug = slugify(cell(row, mapping, 'category_slug'));
  const unitType = grams || parsedPrice?.per ? 'weight' : 'piece';

  return {
    name: normalizeName(cell(row, mapping, 'name')),
    description: String(cell(row, mapping, 'description') ?? '').trim(),
    price: parsedPrice?.value ?? null,
    sale_price: null,
    unit_type: unitType,
    weights: grams ? [{ grams, qty: quantity }] : [],
    num_items: unitType === 'piece' ? quantity : 0,
    category_slug: categorySlug,
    product_type: productTypeForCategory(categorySlug),
    images: [],
    keywords: [],
    barcode: normalizeEan(cell(row, mapping, 'barcode')) || '',
  };
}

function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      complete(result) {
        if (result.errors?.length && !result.data?.length) {
          reject(new Error('csv_parse_failed'));
          return;
        }
        resolve(result.data);
      },
      error: reject,
    });
  });
}

async function parseSpreadsheet(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: 'array',
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error('spreadsheet_empty');
  return XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
}

async function readTabularFile(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('file_too_large');
  const extension = file.name.split('.').pop()?.toLocaleLowerCase('it-IT');
  const data = extension === 'csv' ? await parseCsv(file) : await parseSpreadsheet(file);
  if (!Array.isArray(data) || data.length < 2) throw new Error('file_empty');
  if (data.length > 1_001 || Math.max(...data.map((row) => row.length)) > 50) {
    throw new Error('file_too_many_rows');
  }
  return data;
}

function optionsFor(selectedField) {
  return fieldOptions
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === selectedField ? 'selected' : ''}>${label}</option>`,
    )
    .join('');
}

function mappingByColumn(headers, mapping) {
  return headers.map((_, index) =>
    Object.entries(mapping).find(([, column]) => column === index)?.[0] || '',
  );
}

function confidenceFor(row, mapping) {
  const confidence = {};
  for (const field of ['name', 'price', 'category_slug']) {
    const index = mapping[field];
    if (Number.isInteger(index) && String(row[index] ?? '').trim()) {
      confidence[field] = field === 'category_slug' ? 0.8 : 0.95;
    }
  }
  return confidence;
}

function fileErrorMessage(error) {
  const messages = {
    file_too_large: 'Il file supera 5 MB.',
    file_too_many_rows: 'Importa al massimo 1.000 righe e 50 colonne alla volta.',
    file_empty: 'Il file non contiene righe da importare.',
    spreadsheet_empty: 'Il foglio di calcolo è vuoto.',
  };
  return messages[error?.message] || 'Non riesco a leggere il file. Usa CSV, XLS o XLSX.';
}

export function renderCsv(container) {
  let currentFile = null;
  let headers = [];
  let rows = [];

  function uploadView() {
    container.innerHTML = `
      <div class="focused-view">
        ${renderFocusedHeader('Importa file')}
        <main class="focused-content">
          <section class="file-intro">
            <h1>Carica il tuo listino</h1>
            <p class="muted">CSV o Excel, fino a 1.000 prodotti per volta.</p>
          </section>
          <label class="file-dropzone" id="file-dropzone" for="catalog-file">
            ${icon('file', 'file-dropzone-icon')}
            <strong>Scegli un file</strong>
            <span>CSV, XLS o XLSX · massimo 5 MB</span>
            <input
              class="sr-only"
              id="catalog-file"
              type="file"
              accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            />
          </label>
          <p class="form-error visually-stable" id="file-error" role="alert"></p>
        </main>
      </div>
    `;

    const input = container.querySelector('#catalog-file');
    const dropzone = container.querySelector('#file-dropzone');
    const errorElement = container.querySelector('#file-error');

    async function handleFile(file) {
      if (!file) return;
      currentFile = file;
      errorElement.textContent = '';
      dropzone.classList.add('loading');
      try {
        const data = await readTabularFile(file);
        headers = data[0].map((header) => String(header ?? '').trim());
        rows = data
          .slice(1)
          .filter((row) => row.some((value) => String(value ?? '').trim()));
        mappingView(guessColumnMapping(headers));
      } catch (error) {
        errorElement.textContent = fileErrorMessage(error);
        dropzone.classList.remove('loading');
      }
    }

    input.addEventListener('change', (event) => handleFile(event.target.files[0]));
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('dragging');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragging');
      handleFile(event.dataTransfer.files[0]);
    });
  }

  function mappingView(initialMapping) {
    const selectedByColumn = mappingByColumn(headers, initialMapping);
    container.innerHTML = `
      <div class="focused-view import-view">
        ${renderFocusedHeader('Importa file')}
        <main class="focused-content import-content">
          <div class="uploaded-file">
            ${icon('file', 'uploaded-file-icon')}
            <strong>${esc(currentFile.name)}</strong>
            <button class="btn btn-quiet" id="change-file" type="button">Cambia</button>
          </div>
          <section class="mapping-section" aria-labelledby="mapping-title">
            <h1 id="mapping-title">Abbina le colonne</h1>
            <p class="muted">Controlla come verranno letti i dati.</p>
            <div class="preview-table-wrap">
              <table class="preview-table">
                <thead>
                  <tr>${headers.map((header) => `<th>${esc(header || 'Senza titolo')}</th>`).join('')}</tr>
                </thead>
                <tbody>
                  ${rows
                    .slice(0, 5)
                    .map(
                      (row) =>
                        `<tr>${headers.map((_, index) => `<td>${esc(row[index] ?? '')}</td>`).join('')}</tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
            <div class="column-mapping" id="column-mapping">
              ${headers
                .map(
                  (header, index) => `
                    <label class="mapping-row">
                      <strong>${esc(header || `Colonna ${index + 1}`)}</strong>
                      <select data-column="${index}">
                        ${optionsFor(selectedByColumn[index])}
                      </select>
                    </label>
                  `,
                )
                .join('')}
            </div>
            <p class="import-ready">
              ${icon('check')}
              <span>${rows.length} ${rows.length === 1 ? 'prodotto pronto' : 'prodotti pronti'} per la revisione</span>
            </p>
            <p class="form-error visually-stable" id="mapping-error" role="alert"></p>
          </section>
        </main>
        <div class="fixed-actions">
          <div class="fixed-actions-inner">
            <button class="btn btn-primary" id="import-products" type="button">
              Importa ${rows.length} ${rows.length === 1 ? 'prodotto' : 'prodotti'}
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#change-file').addEventListener('click', uploadView);
    const importButton = container.querySelector('#import-products');
    const errorElement = container.querySelector('#mapping-error');

    importButton.addEventListener('click', async () => {
      const mapping = {};
      container.querySelectorAll('#column-mapping select').forEach((select) => {
        if (select.value && !(select.value in mapping)) {
          mapping[select.value] = Number(select.dataset.column);
        }
      });

      if (!Number.isInteger(mapping.name)) {
        errorElement.textContent = 'Abbina almeno una colonna al campo Nome.';
        return;
      }

      importButton.disabled = true;
      importButton.textContent = 'Importazione…';
      try {
        await Promise.all(
          rows.map((row, index) => {
            const draft = newDraft(
              'file',
              {
                fileName: currentFile.name,
                rowNumber: index + 2,
                row: headers.reduce(
                  (result, header, column) => ({
                    ...result,
                    [header || `column_${column + 1}`]: row[column] ?? '',
                  }),
                  {},
                ),
              },
              rowToDraftParsed(row, mapping),
              confidenceFor(row, mapping),
            );
            return saveDraft(draft, { sync: false });
          }),
        );
        syncDrafts().catch(() => {});
        toast(`${rows.length} bozze importate.`, 'ok');
        window.location.hash = '#/drafts';
      } catch {
        errorElement.textContent = 'Importazione interrotta. Le righe già salvate restano nelle bozze.';
        importButton.disabled = false;
        importButton.textContent = `Importa ${rows.length} prodotti`;
      }
    });
  }

  uploadView();
}
