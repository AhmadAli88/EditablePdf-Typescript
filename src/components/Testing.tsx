/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';
import {
  Highlighter,
  Pen,
  Redo,
  Type,
  Undo,
  Moon,
  Sun,
  Download,
  Signature,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
// Define types for annotations
type Point = { x: number; y: number };

type HighlightAnnotation = {
  type: 'highlight';
  page: number;
  start: Point;
  end: Point;
  color: string;
};

type DrawingAnnotation = {
  type: 'draw';
  page: number;
  points: Point[];
  color: string;
  width: number;
};

type TextAnnotation = {
  type: 'text';
  page: number;
  position: Point;
  text: string;
  color: string;
};

type SignatureAnnotation = {
  type: 'signature';
  page: number;
  position: Point;
  imageData: string;
  width: number;
  height: number;
};
type Annotation =
  | HighlightAnnotation
  | DrawingAnnotation
  | TextAnnotation
  | SignatureAnnotation;

interface PDFViewerProps {
  pdfUrl?: string;
}
interface DrawAnnotation {
  type: 'draw';
  page: number;
  points: { x: number; y: number }[];
  color: string;
  width: number;
}
interface TextItem {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

interface TextContent {
  items: TextItem[];
  styles: Record<string, unknown>;
}
const PDFViewer: React.FC<PDFViewerProps> = ({
  pdfUrl = 'https://almsbe.xeventechnologies.com/api/s3/file/multiple_quizzes-(2).pdf',
}) => {
  // Refs and State Management
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const pageRef = useRef<any>(null);
  // Signature-related states
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<
    { pageNum: number; matches: DOMRect[] }[]
  >([]);
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const [signatureSize, setSignatureSize] = useState<{
    width: number;
    height: number;
  }>({ width: 150, height: 50 });

  // Modify the
  // New state for theme and signature
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(false);
  // PDF-related states
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.5);
  // Undo/Redo State Management
  const [annotationStack, setAnnotationStack] = useState<Annotation[][]>([[]]);
  const [currentStackIndex, setCurrentStackIndex] = useState(0);
  // Annotation-related states
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // Modify the current tool to include signature
  const [currentTool, setCurrentTool] = useState<
    'select' | 'draw' | 'highlight' | 'text' | 'signature'
  >('highlight');
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const [highlightInfo, setHighlightInfo] = useState<{
    start: Point;
    current: Point;
  } | null>(null);

  // Error and UI states
  const [error, setError] = useState<string | null>(null);
  const [annotationColor, setAnnotationColor] = useState<string>('#FFFF00');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>('');
  const [modalPosition, setModalPosition] = useState<Point | null>(null);

  // PDF Loading Effect
  useEffect(() => {
    const loadPDF = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        renderPage(1, pdf);
      } catch (err) {
        console.error('Error loading PDF:', err);
        setError('Failed to load PDF. Please check the file path.');
      }
    };
    loadPDF();
  }, [pdfUrl]);

  // Update handleSignatureUpload function
  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // Create a canvas to resize the image while maintaining aspect ratio
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const maxWidth = 300;
          const maxHeight = 100;
          let width = img.width;
          let height = img.height;

          // Calculate aspect ratio
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }

          canvas.width = width;
          canvas.height = height;
          ctx?.drawImage(img, 0, 0, width, height);

          const resizedImage = canvas.toDataURL('image/png');
          setSignatureImage(resizedImage);
          setSignatureSize({ width, height });
          setCurrentTool('signature');
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };
  // Memoized render function
  const renderPage = useCallback(
    async (
      pageNumber: number,
      pdfDocument: pdfjsLib.PDFDocumentProxy | null = pdfDoc
    ) => {
      if (!pdfDocument || !canvasRef.current) return;

      // Cancel any ongoing render operation
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      try {
        // Clear previous page
        if (pageRef.current) {
          pageRef.current.cleanup();
        }

        const page = await pdfDocument.getPage(pageNumber);
        pageRef.current = page;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        const viewport = page.getViewport({ scale });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Clear the canvas
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Render PDF page
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        renderTaskRef.current = page.render(renderContext);
        await renderTaskRef.current.promise;

        // Render annotations after the page is complete
        renderAnnotations();
      } catch (err) {
        console.error('Error rendering page:', err);
        setError('Failed to render page');
      }
    },
    [pdfDoc, scale]
  );

  // Modified addAnnotation to properly handle drawing history
  const addAnnotation = useCallback(
    (newAnnotation: Annotation) => {
      setAnnotations((prevAnnotations) => {
        const updatedAnnotations = [...prevAnnotations, newAnnotation];

        // Create a new stack entry only when drawing is complete
        if (!isDrawing || newAnnotation.type !== 'draw') {
          const newStack = annotationStack.slice(0, currentStackIndex + 1);
          setAnnotationStack([...newStack, updatedAnnotations]);
          setCurrentStackIndex(currentStackIndex + 1);
        }

        return updatedAnnotations;
      });
    },
    [annotationStack, currentStackIndex, isDrawing]
  );
  // Modify renderAnnotations to include signature rendering
  const renderAnnotations = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    // Create an offscreen canvas for double buffering
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = canvas.width;
    offscreenCanvas.height = canvas.height;
    const offscreenContext = offscreenCanvas.getContext('2d');

    if (!offscreenContext) return;

    // Copy the main canvas content to offscreen canvas
    offscreenContext.drawImage(canvas, 0, 0);

    // Render existing annotations on the offscreen canvas
    offscreenContext.save();

    const pageAnnotations = annotations.filter((a) => a.page === pageNum);

    pageAnnotations.forEach((annotation) => {
      switch (annotation.type) {
        case 'highlight':
          offscreenContext.globalCompositeOperation = 'multiply';
          offscreenContext.fillStyle = annotation.color;
          offscreenContext.globalAlpha = 0.3;
          renderHighlight(offscreenContext, annotation);
          offscreenContext.globalCompositeOperation = 'source-over';
          offscreenContext.globalAlpha = 1;
          break;
        case 'draw':
          renderDrawing(offscreenContext, annotation);
          break;
        case 'text':
          renderTextAnnotation(offscreenContext, annotation);
          break;
        case 'signature':
          renderSignature(offscreenContext, annotation);
          break;
      }
    });

    // Render current highlight in real-time
    if (currentTool === 'highlight' && highlightInfo) {
      offscreenContext.globalAlpha = 0.35;
      renderCurrentHighlight(offscreenContext);
    }

    // Render current drawing in real-time
    if (currentTool === 'draw' && currentPath.length > 1) {
      renderCurrentDrawing(offscreenContext);
    }

    offscreenContext.restore();

    // Copy the offscreen canvas back to the main canvas
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(offscreenCanvas, 0, 0);
  }, [annotations, pageNum, currentTool, currentPath, highlightInfo]);



  const handleSearch = useCallback(async () => {
    if (!searchText || !pdfDoc) return;
  
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent() as TextContent;
    const viewport = page.getViewport({ scale });
    const canvas = canvasRef.current;
    if (!canvas) return;
  
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
  
    // First render the page to clear previous highlights
    await renderPage(pageNum);
  
    let matchCount = 0;
  
    for (const item of textContent.items) {
      const text = item.str || '';
      let startIndex = 0;
      let index;
  
      // Use word boundaries to find exact matches
      const regex = new RegExp(`\\b${searchText}\\b`, 'gi');
      while ((index = regex.exec(text)?.index) !== undefined) {
        matchCount++;
        
        // Calculate exact position of the word
        const transform = item.transform;
        const fontHeight = Math.abs(transform[3] || 12);
        
        // Get the width of text before the match for precise x-position
        const preText = text.substring(0, index);
        ctx.font = `${fontHeight * viewport.scale}px sans-serif`;
        const preWidth = ctx.measureText(preText).width;
        
        // Calculate dimensions for highlight
        const matchWidth = ctx.measureText(searchText).width;
        const x = (transform[4] * viewport.scale) + (preWidth * (transform[0] / fontHeight));
        const y = canvas.height - (transform[5] * viewport.scale);
        
        // Draw highlight with adjusted dimensions
        ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
        ctx.fillRect(
          x,
          y - (fontHeight * viewport.scale),
          matchWidth,
          fontHeight * viewport.scale
        );
  
        startIndex = index + 1;
        regex.lastIndex = startIndex;
      }
    }
  
    // Re-render annotations on top
    renderAnnotations();
    setSearchResults(new Array(matchCount).fill(null));
  }, [searchText, pdfDoc, pageNum, scale, renderPage, renderAnnotations]);

  // Add signature rendering function
  const renderSignature = (
    context: CanvasRenderingContext2D,
    annotation: SignatureAnnotation
  ) => {
    const img = new Image();
    img.src = annotation.imageData;
    context.drawImage(
      img,
      annotation.position.x,
      annotation.position.y,
      annotation.width,
      annotation.height
    );
  };

  // Modified handleUndo to render changes
  const handleUndo = useCallback(() => {
    if (currentStackIndex > 0) {
      const newIndex = currentStackIndex - 1;
      setCurrentStackIndex(newIndex);
      setAnnotations(annotationStack[newIndex]);

      // Force re-render of the PDF with updated annotations
      const canvas = canvasRef.current;
      if (canvas) {
        const context = canvas.getContext('2d');
        if (context) {
          // Clear the canvas
          context.clearRect(0, 0, canvas.width, canvas.height);

          // Re-render the page
          if (pageRef.current) {
            const viewport = pageRef.current.getViewport({ scale });
            const renderContext = {
              canvasContext: context,
              viewport: viewport,
            };

            renderTaskRef.current = pageRef.current.render(renderContext);
            renderTaskRef.current.promise.then(() => {
              // After page renders, draw the annotations
              renderAnnotations();
            });
          }
        }
      }
    }
  }, [currentStackIndex, annotationStack, scale, renderAnnotations]);

  // Modified handleRedo to render changes
  const handleRedo = useCallback(() => {
    if (currentStackIndex < annotationStack.length - 1) {
      const newIndex = currentStackIndex + 1;
      setCurrentStackIndex(newIndex);
      setAnnotations(annotationStack[newIndex]);

      // Force re-render of the PDF with updated annotations
      const canvas = canvasRef.current;
      if (canvas) {
        const context = canvas.getContext('2d');
        if (context) {
          // Clear the canvas
          context.clearRect(0, 0, canvas.width, canvas.height);

          // Re-render the page
          if (pageRef.current) {
            const viewport = pageRef.current.getViewport({ scale });
            const renderContext = {
              canvasContext: context,
              viewport: viewport,
            };

            renderTaskRef.current = pageRef.current.render(renderContext);
            renderTaskRef.current.promise.then(() => {
              // After page renders, draw the annotations
              renderAnnotations();
            });
          }
        }
      }
    }
  }, [currentStackIndex, annotationStack, scale, renderAnnotations]);
  // Add an effect to re-render annotations when they change
  useEffect(() => {
    if (annotations.length >= 0) {
      renderAnnotations();
    }
  }, [annotations, renderAnnotations]);

  const renderHighlight = (
    context: CanvasRenderingContext2D,
    annotation: HighlightAnnotation
  ) => {
    const { start, end, color } = annotation;
    context.fillStyle = color;
    context.fillRect(
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y)
    );
  };

  const renderDrawing = (
    context: CanvasRenderingContext2D,
    annotation: DrawingAnnotation
  ) => {
    context.beginPath();
    context.strokeStyle = annotation.color;
    context.lineWidth = annotation.width;
    annotation.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
  };

  const renderTextAnnotation = (
    context: CanvasRenderingContext2D,
    annotation: TextAnnotation
  ) => {
    context.font = '16px Arial';
    context.fillStyle = annotation.color;
    context.fillText(
      annotation.text,
      annotation.position.x,
      annotation.position.y
    );
  };

  const renderCurrentDrawing = (context: CanvasRenderingContext2D) => {
    context.beginPath();
    context.strokeStyle = annotationColor;
    context.lineWidth = 2;
    currentPath.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
  };

  const renderCurrentHighlight = (context: CanvasRenderingContext2D) => {
    if (!highlightInfo) return;
    const { start, current } = highlightInfo;
    context.globalCompositeOperation = 'multiply';
    context.fillStyle = annotationColor;
    context.globalAlpha = 0.3;
    context.fillRect(
      Math.min(start.x, current.x),
      Math.min(start.y, current.y),
      Math.abs(current.x - start.x),
      Math.abs(current.y - start.y)
    );
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
  };

  // Modify handleMouseDown to handle signature placement
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      switch (currentTool) {
        case 'draw':
          setIsDrawing(true);
          setCurrentPath([{ x, y }]);
          break;
        case 'highlight':
          setHighlightInfo({ start: { x, y }, current: { x, y } });
          break;
        case 'text':
          handleTextAnnotation(x, y);
          break;
        case 'signature':
          if (signatureImage) {
            const newAnnotation: SignatureAnnotation = {
              type: 'signature',
              page: pageNum,
              position: { x, y },
              imageData: signatureImage,
              width: signatureSize.width,
              height: signatureSize.height,
            };
            addAnnotation(newAnnotation);
          }
          break;
      }
    },
    [currentTool, signatureImage, pageNum, addAnnotation, signatureSize]
  );
  // Modified handleMouseMove to update current path without creating stack entries
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || (currentTool !== 'highlight' && currentTool !== 'draw'))
        return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (currentTool === 'draw' && isDrawing) {
        setCurrentPath((prev) => [...prev, { x, y }]);
        renderAnnotations(); // Just render the current state
      }

      if (currentTool === 'highlight' && highlightInfo) {
        setHighlightInfo((prev) =>
          prev ? { ...prev, current: { x, y } } : null
        );
        renderAnnotations();
      }
    },
    [currentTool, isDrawing, renderAnnotations]
  );

  // Modified handleMouseUp to create a single stack entry for the complete drawing
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (currentTool === 'draw' && isDrawing && currentPath.length > 0) {
        const finalPath = [...currentPath, { x, y }];
        const newAnnotation: DrawingAnnotation = {
          type: 'draw',
          page: pageNum,
          points: finalPath,
          color: annotationColor,
          width: 2,
        };

        // Now we create a single stack entry for the complete drawing
        setAnnotations((prev) => {
          const updatedAnnotations = [...prev, newAnnotation];
          const newStack = annotationStack.slice(0, currentStackIndex + 1);
          setAnnotationStack([...newStack, updatedAnnotations]);
          setCurrentStackIndex(currentStackIndex + 1);
          return updatedAnnotations;
        });

        setIsDrawing(false);
        setCurrentPath([]);
      }

      if (currentTool === 'highlight' && highlightInfo) {
        const newAnnotation: HighlightAnnotation = {
          type: 'highlight',
          page: pageNum,
          start: highlightInfo.start,
          end: { x, y },
          color: annotationColor,
        };
        addAnnotation(newAnnotation);
        setHighlightInfo(null);
      }

      renderAnnotations();
    },
    [
      currentTool,
      isDrawing,
      pageNum,
      currentPath,
      highlightInfo,
      annotationColor,
      currentStackIndex,
      annotationStack,
      renderAnnotations,
      addAnnotation,
    ]
  );

  const handleTextAnnotation = (x: number, y: number) => {
    // Store the position and open the modal
    setModalPosition({ x, y });
    setModalText(''); // Clear previous text
    setIsModalOpen(true);
  };
  // Modified clearAllAnnotations to properly reset history
  const clearAllAnnotations = useCallback(() => {
    const emptyState: Annotation[] = [];
    setAnnotations(emptyState);
    setAnnotationStack([emptyState]);
    setCurrentStackIndex(0);
    renderPage(pageNum);
  }, [pageNum, renderPage]);

  const hexToRgb = (hex: any) => {
    // Remove the # if present
    hex = hex.replace('#', '');

    // Parse the hex values directly to RGB values between 0 and 1
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    return { r, g, b };
  };
  // Modified handleModalSubmit to work with the new history system
  const handleModalSubmit = useCallback(() => {
    if (modalText && modalPosition) {
      const newAnnotation: TextAnnotation = {
        type: 'text',
        page: pageNum,
        position: modalPosition,
        text: modalText,
        color: annotationColor,
      };
      addAnnotation(newAnnotation);
      setIsModalOpen(false);
      setModalText('');
      setModalPosition(null);
    }
  }, [modalText, modalPosition, pageNum, annotationColor, addAnnotation]);

  // Function to handle modal cancellation
  const handleModalCancel = () => {
    setIsModalOpen(false);
  };
  // Modify downloadAnnotatedPDF to handle signature
  const downloadAnnotatedPDF = async () => {
    try {
      // Fetch the original PDF
      const existingPdfBytes = await fetch(pdfUrl).then((res) =>
        res.arrayBuffer()
      );
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      // Get the current page
      const page = pdfDoc.getPage(pageNum - 1);
      const pageHeight = page.getHeight();
      const pageWidth = page.getWidth();
      const canvas = canvasRef.current;
      const canvasHeight = canvas.height;
      const canvasWidth = canvas.width;

      // Calculate scaling factors
      const scaleX = pageWidth / canvasWidth;
      const scaleY = pageHeight / canvasHeight;

      // Transform canvas coordinates to PDF page coordinates
      const transformCoordinate = (x: any, y: any) => ({
        x: x * scaleX,
        y: pageHeight - y * scaleY,
      });

      // Add annotations to the page
      for (const annotation of annotations.filter((a) => a.page === pageNum)) {
        switch (annotation.type) {
          case 'highlight': {
            const color = hexToRgb(annotation.color);
            const start = transformCoordinate(
              annotation.start.x,
              annotation.start.y
            );
            const end = transformCoordinate(annotation.end.x, annotation.end.y);

            page.drawRectangle({
              x: Math.min(start.x, end.x),
              y: Math.min(start.y, end.y),
              width: Math.abs(end.x - start.x),
              height: Math.abs(end.y - start.y),
              color: rgb(color.r, color.g, color.b),
              opacity: 0.35,
            });
            break;
          }
          case 'text': {
            const color = hexToRgb(annotation.color);
            const transformedPos = transformCoordinate(
              annotation.position.x,
              annotation.position.y
            );

            page.drawText(annotation.text, {
              x: transformedPos.x,
              y: transformedPos.y,
              size: 16,
              color: rgb(color.r, color.g, color.b),
            });
            break;
          }
          case 'draw': {
            const color = hexToRgb(annotation.color);
            const scaledPoints = annotation.points.map((point) =>
              transformCoordinate(point.x, point.y)
            );

            for (let i = 1; i < scaledPoints.length; i++) {
              const prev = scaledPoints[i - 1];
              const curr = scaledPoints[i];
              page.drawLine({
                start: prev,
                end: curr,
                thickness: annotation.width,
                color: rgb(color.r, color.g, color.b),
              });
            }
            break;
          }
          case 'signature': {
            const transformedPos = transformCoordinate(
              annotation.position.x,
              annotation.position.y
            );

            // Embed the signature image
            const signatureImg = await pdfDoc.embedPng(
              await fetch(annotation.imageData).then((r) => r.arrayBuffer())
            );

            page.drawImage(signatureImg, {
              x: transformedPos.x,
              y: transformedPos.y,
              width: annotation.width * scaleX,
              height: annotation.height * scaleY,
            });
            break;
          }
        }
      }

      const pdfBytes = await pdfDoc.save();

      // Download the PDF
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const downloadLink = document.createElement('a');
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = 'annotated-document.pdf';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch (error) {
      console.error('Error downloading annotated PDF:', error);
    }
  };
  // Cleanup effect
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
      if (pageRef.current) {
        pageRef.current.cleanup();
      }
    };
  }, []);

  // New function to download canvas as image
  const downloadCanvasAsImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create a temporary link to trigger download
    const link = document.createElement('a');
    link.download = `pdf-page-${pageNum}-annotated.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  return (
    <div
      className={`w-full mx-auto p-4 transition-colors duration-300 ${
        isDarkTheme ? 'bg-gray-900 text-white' : 'bg-white text-black'
      }`}
    >
      <div className='absolute top-4 right-4'>
        <button
          onClick={() => setIsDarkTheme(!isDarkTheme)}
          className={`p-2 rounded-full ${
            isDarkTheme
              ? 'bg-gray-700 text-yellow-400'
              : 'bg-gray-200 text-gray-800'
          }`}
        >
          {isDarkTheme ? <Sun size={24} /> : <Moon size={24} />}
        </button>
      </div>
      <input
        type='file'
        ref={signatureInputRef}
        accept='image/*'
        onChange={handleSignatureUpload}
        className='hidden'
      />
      {/* Error Display */}
      {isModalOpen && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50'>
          <div className='bg-white rounded-lg p-6 shadow-lg w-96'>
            <h2 className='text-lg font-semibold mb-4'>Add Text Annotation</h2>
            <textarea
              className='w-full border border-gray-300 rounded-lg p-2 h-20'
              value={modalText}
              onChange={(e) => setModalText(e.target.value)}
              placeholder='Enter annotation text here...'
            />
            <div className='flex justify-end mt-4 gap-2'>
              <button
                className='px-4 py-2 bg-gray-300 text-black rounded hover:bg-gray-400'
                onClick={handleModalCancel}
              >
                Cancel
              </button>
              <button
                className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600'
                onClick={handleModalSubmit}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className='bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4'>
          {error}
        </div>
      )}

      {/* Flexbox Container */}
      <div
        className={`flex gap-4 custom-height overflow-hidden ${
          isDarkTheme
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-300'
        }`}
      >
        {/* PDF Viewer */}
        <div
          className={`flex-grow relative border rounded custom-boxShadow ${
            isDarkTheme
              ? 'border-gray-700 bg-gray-800'
              : 'border-gray-300 bg-white'
          }`}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`cursor-${
              currentTool === 'highlight' ||
              currentTool === 'draw' ||
              currentTool === 'signature'
                ? 'crosshair'
                : currentTool === 'text'
                ? 'text'
                : 'default'
            }`}
            // className={`cursor-${
            //   currentTool === 'highlight'
            //     ? 'crosshair'
            //     : currentTool === 'draw'
            //     ? 'crosshair'
            //     : currentTool === 'text'
            //     ? 'text'
            //     : 'default'
            // }`}
          />
        </div>

        {/* Toolbar */}
        <div
          className={`flex-shrink-0 p-4 border rounded custom-boxShadow ${
            isDarkTheme
              ? 'bg-gray-700 border-gray-600 text-white'
              : 'bg-gray-100 border-gray-300'
          }`}
        >
          <h3 className='text-lg font-bold mb-4'>Tools</h3>
          {/* Tool Selection Buttons */}
          <div className='mb-4 flex flex-col gap-2'>
            <button
              key='highlight'
              className={`px-3 py-2 rounded flex items-center gap-2 ${
                currentTool === 'highlight' ? 'bg-green-700' : 'bg-green-500'
              } text-white hover:bg-green-600`}
              onClick={() => setCurrentTool('highlight')}
              title='Highlight'
            >
              <Highlighter size={18} />
              Highlight
            </button>

            <button
              key='draw'
              className={`px-3 py-2 rounded flex items-center gap-2 ${
                currentTool === 'draw' ? 'bg-purple-700' : 'bg-purple-500'
              } text-white hover:bg-purple-600`}
              onClick={() => setCurrentTool('draw')}
              title='Draw'
            >
              <Pen size={18} />
              Draw
            </button>

            <button
              key='text'
              className={`px-3 py-2 rounded flex items-center gap-2 ${
                currentTool === 'text' ? 'bg-blue-700' : 'bg-blue-500'
              } text-white hover:bg-blue-600`}
              onClick={() => setCurrentTool('text')}
              title='Text Annotation'
            >
              <Type size={18} />
              Text
            </button>
            <div className='flex gap-2 mt-4 flex-wrap'>
              <button
                className={`px-3 py-2 rounded flex items-center gap-2 ${
                  currentStackIndex <= 0
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600'
                } text-white`}
                onClick={handleUndo}
                disabled={currentStackIndex <= 0}
                title='Undo'
              >
                <Undo size={18} />
                Undo
              </button>
              <button
                className={`px-3 py-2 rounded flex items-center gap-2 ${
                  currentStackIndex >= annotationStack.length - 1
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600'
                } text-white`}
                onClick={handleRedo}
                disabled={currentStackIndex >= annotationStack.length - 1}
                title='Redo'
              >
                <Redo size={18} />
                Redo
              </button>
              <button
                key='signature'
                className={`px-3 py-2 rounded flex items-center gap-2 ${
                  currentTool === 'signature'
                    ? 'bg-indigo-700'
                    : 'bg-indigo-500'
                } text-white hover:bg-indigo-600`}
                onClick={() => {
                  // If no signature, trigger file upload
                  if (!signatureImage) {
                    signatureInputRef.current?.click();
                  } else {
                    setCurrentTool('signature');
                  }
                }}
                title='Add Signature'
              >
                <Signature size={18} />
                Signature
              </button>
            </div>
          </div>
          {signatureImage && (
            <div className='mt-4'>
              <p className='text-sm mb-2'>Signature Preview:</p>
              <div className='flex items-center gap-2'>
                <img
                  src={signatureImage}
                  alt='Signature'
                  className='max-w-full h-auto rounded border'
                />
                <button
                  className='px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600'
                  onClick={() => {
                    setSignatureImage(null);
                    setCurrentTool('highlight');
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          <div className='mb-4'>
            <h4 className='text-lg font-bold mb-2'>Search</h4>
            <div className='flex gap-2'>
              <input
                type='text'
                placeholder='Search text...'
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className='flex-1 p-2 border rounded text-black'
              />
              <button
                className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600'
                onClick={handleSearch}
                disabled={!searchText}
              >
                Search
              </button>
            </div>
            {searchResults.length > 0 && (
              <p className='text-sm mt-2'>
                Found {searchResults.length} matches
              </p>
            )}
          </div>
          {/* Color Picker */}
          <div className='mb-4'>
            <label className='block text-sm font-medium mb-1'>Color:</label>
            <input
              type='color'
              value={annotationColor}
              onChange={(e) => setAnnotationColor(e.target.value)}
              className='h-10 w-full border border-gray-300 rounded'
            />
          </div>
          {/* Utility Buttons */}
          <div className='flex flex-col gap-2'>
            <button
              className='px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600'
              onClick={clearAllAnnotations}
            >
              Clear All
            </button>
            <button
              className='px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600'
              onClick={downloadAnnotatedPDF}
            >
              Download PDF
            </button>

            <button
              className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600'
              onClick={downloadCanvasAsImage}
            >
              <Download size={18} className='mr-2 inline' />
              Download Image
            </button>
          </div>
        </div>
      </div>

      {/* Page Navigation */}
      <div
        className={`mt-4 flex justify-center items-center gap-4 ${
          isDarkTheme ? 'text-white' : 'text-black'
        }`}
      >
        <button
          className='px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600'
          onClick={() => {
            const newPage = pageNum - 1;
            if (newPage >= 1) {
              setPageNum(newPage);
              renderPage(newPage);
            }
          }}
          disabled={pageNum <= 1}
        >
          Previous
        </button>
        <span className='py-2'>
          Page {pageNum} of {totalPages}
        </span>
        <button
          className='px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600'
          onClick={() => {
            const newPage = pageNum + 1;
            if (newPage <= totalPages) {
              setPageNum(newPage);
              renderPage(newPage);
            }
          }}
          disabled={pageNum >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default PDFViewer;
