import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, FileText, AlertCircle, CheckCircle, ExternalLink, Loader, Zap, Save, Copy, Database, Search } from 'lucide-react';
import Tesseract from 'tesseract.js';

// Datos fiscales fijos de Westcon México
const DATOS_FISCALES = {
  rfc: 'WME000218GK3',
  razonSocial: 'Westcon México',
  email: 'fabian.gomez2@tdsynnex.com',
  cp: '03100',
  usoCFDI: 'G03',
  regimenFiscal: '601'
};

// Base de datos de restaurantes conocidos
const RESTAURANTES_BASE = [
  { 
    nombre: 'Eric Kayser', 
    patron: /ERIC\s*KAYSER|KAYSER|MAISON/i,
    rfc: 'EKM1404018JI',
    portal: 'https://www.maison-kayser.com.mx',
    campos: { rfc: 'rfc', email: 'email', total: 'monto', folio: 'ticket' }
  },
  { 
    nombre: 'VIPS', 
    patron: /VIPS/i,
    rfc: 'RES850101XXX',
    portal: 'https://www.vips.com.mx/facturacion',
    campos: { rfc: 'rfc', email: 'correo', total: 'total', folio: 'folio' }
  },
  { 
    nombre: 'Starbucks', 
    patron: /STARBUCKS/i,
    rfc: 'SCC140127XXX',
    portal: 'https://www.starbucks.com.mx/facturacion',
    campos: { rfc: 'rfc', email: 'email', total: 'importe', folio: 'numero_ticket' }
  }
];

function App() {
  const [imagen, setImagen] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [datosExtraidos, setDatosExtraidos] = useState(null);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');
  const [pasoActual, setPasoActual] = useState('');
  const [mostrarFormPortal, setMostrarFormPortal] = useState(false);
  const [portalManual, setPortalManual] = useState('');
  const [restaurantesAprendidos, setRestaurantesAprendidos] = useState([]);
  
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // Cargar restaurantes aprendidos del localStorage
  useEffect(() => {
    const guardados = localStorage.getItem('restaurantes_aprendidos');
    if (guardados) {
      try {
        setRestaurantesAprendidos(JSON.parse(guardados));
      } catch (e) {
        console.error('Error cargando restaurantes:', e);
      }
    }
  }, []);

  // OCR + Extracción de datos
  const procesarTicket = async (file) => {
    setProcesando(true);
    setError('');
    setExito('');
    setPasoActual('');
    
    try {
      const imageUrl = URL.createObjectURL(file);
      setImagen(imageUrl);

      // Paso 1: OCR
      setPasoActual('🔍 Escaneando ticket...');
      const { data } = await Tesseract.recognize(file, 'spa', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const progress = Math.round(m.progress * 100);
            setPasoActual(`📄 Leyendo texto... ${progress}%`);
          }
        }
      });

      const texto = data.text;
      console.log('📝 Texto extraído:', texto);

      // Paso 2: Analizar datos
      setPasoActual('🤖 Analizando datos...');
      const datos = extraerDatos(texto);
      
      // Paso 3: Buscar portal
      setPasoActual('🌐 Buscando portal de facturación...');
      const portal = buscarPortal(datos, texto);
      
      datos.portal = portal;
      setDatosExtraidos(datos);
      
      if (!portal) {
        setMostrarFormPortal(true);
        setPasoActual('⚠️ Portal no identificado - ingresa manualmente');
      } else {
        setPasoActual('✅ Todo listo');
        setExito(`Portal identificado: ${portal.url}`);
      }

    } catch (err) {
      console.error('Error:', err);
      setError('Error al leer el ticket. Intenta con mejor iluminación.');
    } finally {
      setProcesando(false);
    }
  };

  // Extraer datos del texto OCR
  const extraerDatos = (texto) => {
    // RFC del restaurante
    const regexRFC = /([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/g;
    const rfcs = texto.match(regexRFC);
    const rfcRestaurante = rfcs ? rfcs[0] : '';

    // Folio
    const regexFolio = /(?:FOLIO|TICKET|NOTA|NO\.?\s*TICKET)[:\s#]*(\w+)/i;
    const matchFolio = texto.match(regexFolio);
    const folio = matchFolio ? matchFolio[1] : '';

    // Fecha
    const regexFecha = /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/;
    const matchFecha = texto.match(regexFecha);
    const fecha = matchFecha ? matchFecha[1] : '';

    // Subtotal
    const regexSubtotal = /SUBTOTAL[:\s]*\$?\s*([\d,]+\.?\d{0,2})/i;
    const matchSubtotal = texto.match(regexSubtotal);
    const subtotal = matchSubtotal ? parseFloat(matchSubtotal[1].replace(',', '')) : 0;

    // IVA
    const regexIVA = /IVA[:\s]*\$?\s*([\d,]+\.?\d{0,2})/i;
    const matchIVA = texto.match(regexIVA);
    const iva = matchIVA ? parseFloat(matchIVA[1].replace(',', '')) : 0;

    // Total sin propina
    const regexTotalSin = /TOTAL\s+SIN\s+PROPINA[:\s]*\$?\s*([\d,]+\.?\d{0,2})/i;
    const matchTotalSin = texto.match(regexTotalSin);
    let total = matchTotalSin ? parseFloat(matchTotalSin[1].replace(',', '')) : 0;
    
    if (total === 0 && subtotal > 0) {
      total = subtotal + iva;
    }

    if (total === 0) {
      const regexTotal = /TOTAL[:\s]*\$?\s*([\d,]+\.?\d{0,2})/i;
      const matchTotal = texto.match(regexTotal);
      total = matchTotal ? parseFloat(matchTotal[1].replace(',', '')) : 0;
    }

    // Nombre del restaurante
    const lineas = texto.split('\n').filter(l => l.trim().length > 3);
    const nombreRestaurante = lineas[0] || 'Restaurante';

    return {
      nombreRestaurante,
      rfcRestaurante,
      folio,
      fecha,
      subtotal,
      iva,
      total,
      textoCompleto: texto
    };
  };

  // Buscar portal en base de datos
  const buscarPortal = (datos, texto) => {
    // 1. Buscar en base predefinida
    for (const rest of RESTAURANTES_BASE) {
      if (rest.patron.test(texto)) {
        return { url: rest.portal, nombre: rest.nombre, campos: rest.campos, origen: 'predefinido' };
      }
    }

    // 2. Buscar en restaurantes aprendidos
    for (const rest of restaurantesAprendidos) {
      if (texto.toUpperCase().includes(rest.nombre.toUpperCase())) {
        return { url: rest.portal, nombre: rest.nombre, campos: rest.campos || {}, origen: 'aprendido' };
      }
    }

    // 3. Buscar URL en el ticket
    const regexURL = /(www\.[a-z0-9\-\.]+|https?:\/\/[^\s]+)/i;
    const matchURL = texto.match(regexURL);
    if (matchURL) {
      let url = matchURL[1];
      if (!url.startsWith('http')) url = 'https://' + url;
      return { url, nombre: datos.nombreRestaurante, campos: {}, origen: 'detectado' };
    }

    return null;
  };

  // Guardar portal aprendido
  const guardarPortalAprendido = () => {
    if (!portalManual || !datosExtraidos) return;

    let url = portalManual.trim();
    if (!url.startsWith('http')) url = 'https://' + url;

    const nuevoRestaurante = {
      nombre: datosExtraidos.nombreRestaurante,
      portal: url,
      rfc: datosExtraidos.rfcRestaurante,
      fecha_agregado: new Date().toISOString()
    };

    const actualizados = [...restaurantesAprendidos, nuevoRestaurante];
    setRestaurantesAprendidos(actualizados);
    localStorage.setItem('restaurantes_aprendidos', JSON.stringify(actualizados));

    datosExtraidos.portal = { url, nombre: datosExtraidos.nombreRestaurante, campos: {}, origen: 'manual' };
    setDatosExtraidos({...datosExtraidos});
    setMostrarFormPortal(false);
    setPortalManual('');
    setExito('✅ Portal guardado. La próxima vez será automático.');
  };

  // Abrir portal e intentar llenar
  const abrirPortal = () => {
    if (!datosExtraidos?.portal) return;

    const params = new URLSearchParams({
      rfc: DATOS_FISCALES.rfc,
      email: DATOS_FISCALES.email,
      cp: DATOS_FISCALES.cp,
      razon_social: DATOS_FISCALES.razonSocial,
      uso_cfdi: DATOS_FISCALES.usoCFDI,
      regimen_fiscal: DATOS_FISCALES.regimenFiscal,
      rfc_emisor: datosExtraidos.rfcRestaurante,
      folio: datosExtraidos.folio,
      fecha: datosExtraidos.fecha,
      total: datosExtraidos.total.toFixed(2)
    });

    const urlConParams = `${datosExtraidos.portal.url}?${params.toString()}`;
    
    // Copiar datos al portapapeles como backup
    copiarDatos();
    
    // Abrir portal
    window.open(urlConParams, '_blank');
    setExito('✅ Portal abierto. Datos copiados al portapapeles por si necesitas pegarlos.');
  };

  // Copiar datos formateados
  const copiarDatos = () => {
    if (!datosExtraidos) return;

    const texto = `
━━━━━━━━━━━━━━━━━━━━━━━━━
📋 DATOS PARA FACTURACIÓN
━━━━━━━━━━━━━━━━━━━━━━━━━

🏢 WESTCON MÉXICO
RFC: ${DATOS_FISCALES.rfc}
Razón Social: ${DATOS_FISCALES.razonSocial}
Email: ${DATOS_FISCALES.email}
C.P.: ${DATOS_FISCALES.cp}
Uso CFDI: ${DATOS_FISCALES.usoCFDI} (Gastos en general)
Régimen Fiscal: ${DATOS_FISCALES.regimenFiscal}

━━━━━━━━━━━━━━━━━━━━━━━━━
📄 DATOS DEL TICKET
━━━━━━━━━━━━━━━━━━━━━━━━━

Restaurante: ${datosExtraidos.nombreRestaurante}
RFC Emisor: ${datosExtraidos.rfcRestaurante}
Folio: ${datosExtraidos.folio}
Fecha: ${datosExtraidos.fecha}
Total a facturar: $${datosExtraidos.total.toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━━━━━
${datosExtraidos.portal ? `Portal: ${datosExtraidos.portal.url}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    navigator.clipboard.writeText(texto).then(() => {
      setExito('✅ Datos copiados al portapapeles');
    }).catch(() => {
      alert(texto);
    });
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      procesarTicket(file);
    }
  };

  const resetear = () => {
    setImagen(null);
    setDatosExtraidos(null);
    setError('');
    setExito('');
    setMostrarFormPortal(false);
    setPortalManual('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-4 pb-20">
      <div className="max-w-3xl mx-auto">
        
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6 border-t-4 border-indigo-600">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="w-8 h-8 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Facturador Westcon</h1>
              <p className="text-sm text-indigo-600 font-medium">Automatización inteligente</p>
            </div>
          </div>
          <p className="text-gray-600 text-sm">
            Escanea tickets y factúralos automáticamente a nombre de Westcon México
          </p>
        </div>

        {/* Alertas */}
        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 mb-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {exito && (
          <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 mb-4 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-green-800 text-sm">{exito}</p>
          </div>
        )}

        {/* Captura de ticket */}
        {!datosExtraidos && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
            <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Camera className="w-5 h-5 text-indigo-600" />
              Capturar Ticket
            </h2>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <button
                onClick={() => cameraInputRef.current?.click()}
                disabled={procesando}
                className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-indigo-300 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition-all disabled:opacity-50 active:scale-95"
              >
                <Camera className="w-12 h-12 text-indigo-600 mb-2" />
                <span className="text-sm font-semibold text-gray-700">Tomar Foto</span>
              </button>
              
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={procesando}
                className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-indigo-300 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition-all disabled:opacity-50 active:scale-95"
              >
                <Upload className="w-12 h-12 text-indigo-600 mb-2" />
                <span className="text-sm font-semibold text-gray-700">Subir Imagen</span>
              </button>
            </div>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Restaurantes aprendidos */}
            {restaurantesAprendidos.length > 0 && (
              <div className="mt-4 p-4 bg-indigo-50 rounded-lg">
                <h3 className="text-sm font-semibold text-indigo-900 mb-2 flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Restaurantes Guardados ({restaurantesAprendidos.length})
                </h3>
                <div className="space-y-1 text-xs text-indigo-700">
                  {restaurantesAprendidos.slice(-5).map((r, i) => (
                    <div key={i}>• {r.nombre}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Vista previa */}
        {imagen && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              Ticket Capturado
            </h3>
            <img src={imagen} alt="Ticket" className="w-full rounded-lg border-2 border-gray-200 max-h-80 object-contain" />
          </div>
        )}

        {/* Procesamiento */}
        {procesando && (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl shadow-lg p-6 mb-6 border border-indigo-200">
            <div className="flex items-center gap-3">
              <Loader className="w-7 h-7 text-indigo-600 animate-spin" />
              <span className="text-gray-800 font-medium">{pasoActual}</span>
            </div>
          </div>
        )}

        {/* Datos extraídos */}
        {datosExtraidos && (
          <div className="space-y-4 mb-6">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <h3 className="font-bold text-lg text-gray-800">Datos Extraídos</h3>
              </div>

              {/* Restaurante */}
              <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                <div className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Restaurante:</span>
                    <span className="font-semibold text-gray-800">{datosExtraidos.nombreRestaurante}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">RFC:</span>
                    <span className="font-mono font-semibold text-gray-800">{datosExtraidos.rfcRestaurante}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Folio:</span>
                    <span className="font-semibold text-gray-800">{datosExtraidos.folio}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Fecha:</span>
                    <span className="font-semibold text-gray-800">{datosExtraidos.fecha}</span>
                  </div>
                </div>
              </div>

              {/* Total */}
              <div className="p-4 bg-green-50 rounded-lg border-2 border-green-200 mb-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Total a Facturar:</span>
                  <span className="font-bold text-2xl text-green-700">${datosExtraidos.total.toFixed(2)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Sin propina</p>
              </div>

              {/* Portal */}
              {datosExtraidos.portal && (
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <ExternalLink className="w-4 h-4 text-blue-700" />
                    <span className="text-sm font-semibold text-blue-900">Portal Identificado:</span>
                  </div>
                  <p className="text-xs text-blue-800 break-all">{datosExtraidos.portal.url}</p>
                  <p className="text-xs text-blue-600 mt-1">Origen: {datosExtraidos.portal.origen}</p>
                </div>
              )}
            </div>

            {/* Form para portal manual */}
            {mostrarFormPortal && (
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-6">
                <h3 className="font-semibold text-yellow-900 mb-3 flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Portal no identificado
                </h3>
                <p className="text-sm text-yellow-800 mb-4">
                  Ingresa la URL del portal de facturación y se guardará para futuras veces:
                </p>
                <input
                  type="text"
                  value={portalManual}
                  onChange={(e) => setPortalManual(e.target.value)}
                  placeholder="www.restaurante.com/facturacion"
                  className="w-full px-4 py-3 border-2 border-yellow-300 rounded-lg mb-3 focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                />
                <button
                  onClick={guardarPortalAprendido}
                  className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  <Save className="w-5 h-5" />
                  Guardar Portal
                </button>
              </div>
            )}

            {/* Botones de acción */}
            <div className="space-y-3">
              {datosExtraidos.portal && (
                <button
                  onClick={abrirPortal}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-3 shadow-lg active:scale-95 transition-all"
                >
                  <Zap className="w-6 h-6" />
                  Abrir Portal y Facturar
                  <ExternalLink className="w-5 h-5" />
                </button>
              )}

              <button
                onClick={copiarDatos}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <Copy className="w-5 h-5" />
                Copiar Todos los Datos
              </button>

              <button
                onClick={resetear}
                className="w-full bg-white hover:bg-gray-50 text-gray-600 font-semibold py-3 rounded-xl border-2 border-gray-200 flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                🔄 Nuevo Ticket
              </button>
            </div>
          </div>
        )}

        {/* Instrucciones */}
        {!datosExtraidos && !procesando && (
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h3 className="font-bold text-gray-800 mb-4">📖 Cómo funciona</h3>
            <ol className="space-y-3 text-sm text-gray-600">
              <li className="flex gap-3">
                <span className="font-bold text-indigo-600">1.</span>
                <span>Toma foto clara del ticket (buena luz, enfocado)</span>
              </li>
              <li className="flex gap-3">
                <span className="font-bold text-indigo-600">2.</span>
                <span>OCR lee automáticamente todos los datos (5-10 seg)</span>
              </li>
              <li className="flex gap-3">
                <span className="font-bold text-indigo-600">3.</span>
                <span>Si es restaurante conocido, abre portal automáticamente</span>
              </li>
              <li className="flex gap-3">
                <span className="font-bold text-indigo-600">4.</span>
                <span>Si es nuevo, ingresas el portal y se guarda para siempre</span>
              </li>
              <li className="flex gap-3">
                <span className="font-bold text-indigo-600">5.</span>
                <span>Portal se abre con datos de Westcon prellenados</span>
              </li>
            </ol>

            <div className="mt-4 p-4 bg-indigo-50 rounded-lg">
              <p className="text-sm text-indigo-800">
                <strong>💡 Datos Westcon configurados:</strong><br/>
                RFC: {DATOS_FISCALES.rfc} • CP: {DATOS_FISCALES.cp} • Régimen: {DATOS_FISCALES.regimenFiscal}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;