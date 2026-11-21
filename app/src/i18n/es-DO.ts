// Every UI string (BRIEF.md §11). Functions for strings with values.
import { money } from '../format';

const s = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const T = {
  appName: 'Mis Facturas',
  todayLine: (d: string) => `Hoy: ${d}`,
  tabs: { topay: 'Por pagar', paid: 'Pagadas', prov: 'Suplidores', caja: 'Caja' },
  fab: { topay: '+ Factura', paid: '+ Factura', prov: '+ Suplidor', caja: '+ Movimiento' },
  prevMonth: 'Mes anterior', nextMonth: 'Mes siguiente', all: 'Todos', allMonths: 'Todos los meses',

  owedLabel: (month: string | null) => 'Falta por pagar' + (month ? ` · facturas de ${month}` : ''),
  urgentLabel: 'Urgentes:',
  urgentCount: (n: number) => s(n, 'factura', 'facturas'),
  paidInLabel: (per: string, amt: number) => `Pagado ${per}: ${money(amt)}`,
  balanceLabel: (per: string) => `Balance ${per}`,
  inLabel: 'Entradas:', outLabel: 'Salidas:',
  perMonth: (m: string) => `en ${m}`, perAll: 'en total',

  olderNotice: (n: number) => `Hay ${s(n, 'factura pendiente', 'facturas pendientes')} de meses anteriores.`,
  seeAll: 'Ver todas',
  emptyToPay: 'No hay facturas pendientes de este mes. 🎉',
  emptyToPayHint: 'Toque “+ Factura” para agregar una.',
  emptyPaid: 'No hay facturas saldadas en este mes.',
  emptyProv: 'Todavía no hay suplidores.',
  emptyCaja: 'No hay movimientos este mes.',
  emptyCajaHint: 'Toque “+ Movimiento” para anotar la venta del día.',
  noPhoto: 'Sin foto',
  entered: (d: string) => `entró ${d}`,
  toPaySmall: 'a pagar', restOf: (amt: number) => `resta de ${money(amt)}`, totalSmall: 'total',
  partial: 'Abonada', paidOn: (d: string) => `Pagada ${d}`,
  pendingCount: (n: number) => s(n, 'pendiente', 'pendientes'),
  inWord: 'Entrada', outWord: 'Salida',

  // sheets
  close: 'Cerrar',
  newInvoice: 'Nueva factura', invoiceNo: (num: string) => `Factura #${num}`,
  photoLabel: 'Foto de la factura', takePhoto: '📷 Tomar o elegir una foto', addPhoto: '📷 Agregar una foto',
  supplier: 'Suplidor', amountRD: 'Monto (RD$)', enteredDate: 'Fecha de entrada', priority: 'Prioridad',
  saveInvoice: 'Guardar factura',
  factAmount: 'Monto', factOwed: 'Se debe', factEntered: 'Entró', factSettled: 'Saldada el',
  payAmount: 'Monto a pagar', payDate: 'Fecha de pago', payHalf: 'Pagar la mitad', registerPay: 'Registrar pago',
  paymentsTitle: (n: number) => `Pagos y abonos (${n})`, noPayments: 'Todavía no hay pagos.', removePay: 'Quitar pago',
  deleteInvoice: 'Borrar factura', tapAgain: 'Toque otra vez para borrar',
  newSupplier: 'Nuevo suplidor', editSupplier: 'Editar suplidor', supplierId: (id: string) => `ID ${id}`,
  name: 'Nombre', description: 'Descripción', usualPrio: 'Prioridad usual',
  saveSupplier: 'Guardar suplidor', deleteSupplier: 'Borrar suplidor',
  newMove: 'Nuevo movimiento', editMove: 'Editar movimiento', whatKind: '¿Qué está anotando?',
  moveIn: 'Entrada (ingreso)', moveOut: 'Salida (pago)', kind: 'Tipo', date: 'Fecha',
  noteOptional: 'Nota (opcional)', notePlaceholder: 'Ej.: quincena, ITBIS, pedido…', save: 'Guardar', deleteMove: 'Borrar movimiento',
  photoAlt: 'Foto de la factura',

  // toasts
  tInvoiceSaved: 'Factura guardada', tSupplierSaved: 'Suplidor guardado', tInSaved: 'Entrada guardada', tOutSaved: 'Salida guardada',
  tSettled: '¡Saldada! ✓', tPartial: (left: number) => `Abono guardado — faltan ${money(left)}`,
  tPayRemoved: 'Pago quitado', tInvoiceDeleted: 'Factura borrada', tSupplierDeleted: 'Suplidor borrado', tMoveDeleted: 'Movimiento borrado',
  tPhotoAdded: 'Foto agregada', tPrio: (p: string) => `Prioridad: ${p}`, tWriteAmount: 'Escriba un monto',
  tTooMuch: (bal: number) => `Eso es más de lo que se debe (${money(bal)})`,
  tAddSupplierFirst: 'Primero agregue un suplidor', tSupplierHasInvoices: 'Este suplidor todavía tiene facturas',
  tBadPhoto: 'No se pudo leer esa foto', tCantSave: 'No se pudo guardar en este equipo', tWriteName: 'Escriba un nombre',

  // sync
  syncOk: 'Sincronizado', syncPending: 'Cambios por enviar', syncOffline: 'Sin conexión — se guardará al volver la señal',
  syncError: 'No se pudo sincronizar. Se intentará de nuevo.',
  lastSync: (ago: string) => `Última sincronización: ${ago}`, never: 'todavía no', agoNow: 'hace un momento',
  agoMin: (n: number) => `hace ${s(n, 'min', 'min')}`, agoHour: (n: number) => `hace ${s(n, 'hora', 'horas')}`,

  // footer
  backup: 'Respaldo', restore: 'Restaurar respaldo', howToInstall: 'Cómo instalar', demoNote: 'Demo con datos de ejemplo, guardados solo en este equipo.',
  resetDemo: 'Reiniciar demo', tBackupDone: 'Respaldo descargado', tRestoreDone: 'Respaldo restaurado', tRestoreBad: 'Ese archivo no es un respaldo',
  installTitle: 'Cómo instalar',
  installSteps: [
    'Abra esta página en Safari (iPhone o iPad) o Chrome (Android).',
    'iPhone/iPad: toque Compartir (el cuadrado con la flecha) y luego “Agregar a pantalla de inicio”.',
    'Android: toque el menú ⋮ y luego “Instalar app” o “Agregar a pantalla principal”.',
    'Abra Mis Facturas desde el ícono naranja.',
  ],

  // onboarding + PIN (BRIEF.md §5.11)
  welcome: 'Para anotar las facturas, los pagos y la caja del negocio.', start: 'Empezar',
  apiUrlTitle: 'Dirección de la hoja', apiUrlHelp: 'Pegue la dirección del script (termina en /exec).', apiUrlBad: 'Esa dirección no parece correcta.',
  keyTitle: 'Clave de la hoja', keyHelp: 'Es la clave que le dio quien le instaló la app.', continue: 'Continuar',
  keyBad: 'Esa clave no es. Pregúntele a quien le instaló la app.', needInternet: 'Necesita internet para la primera vez.',
  serverBad: 'No se pudo conectar con la hoja. Intente otra vez.',
  whoTitle: '¿Quién es usted?', noUsers: 'No hay personas en la pestaña Usuarios de la hoja.',
  createPin: 'Cree su PIN', createPinHelp: 'Cuatro números. Lo va a usar para entrar en este equipo.',
  repeatPin: 'Repita su PIN', pinMismatch: 'No son iguales. Intente otra vez.',
  enterPin: 'Escriba su PIN para entrar', pinWrong: 'Ese PIN no es. Intente otra vez.',
  pinTriesLeft: (n: number) => `Le ${n === 1 ? 'queda 1 intento' : `quedan ${n} intentos`}.`,
  pinReset: 'Demasiados intentos. Entre otra vez con la clave de la hoja.',
  forgotPin: '¿Olvidó su PIN? Pídale ayuda a quien le instaló la app.', useKey: 'Entrar con la clave de la hoja',
  loading: 'Cargando sus datos…', deleteKey: 'Borrar', back: 'Atrás',
};
